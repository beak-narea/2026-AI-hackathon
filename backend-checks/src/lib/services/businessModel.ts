import "server-only";
import type { Db } from "../supabase/server";
import { conflict, must, notFound } from "../api/handler";
import { llmFor } from "../llm/factory";
import { businessModelPrompt, canvasCheckPrompt, type CanvasCheck } from "../llm/prompts";
import { gatherMaterial, type SourceInput } from "./sources";

export const CANVAS_FIELDS = [
  "problem", "customer_segments", "unique_value_proposition", "solution", "channels",
  "revenue_streams", "cost_structure", "key_metrics", "unfair_advantage",
] as const;
export type CanvasField = (typeof CANVAS_FIELDS)[number];
export type Canvas = Record<CanvasField, string>;

async function nextVersion(admin: Db, projectId: string): Promise<number> {
  const { data } = await admin
    .from("business_models")
    .select("version")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1);
  return (data?.[0]?.version ?? 0) + 1;
}

/** 버전 번호를 매겨 저장한다. 동시에 저장하면 번호가 겹치므로 다시 매겨 최대 3번 시도한다 */
async function insertVersion(admin: Db, projectId: string, row: Record<string, unknown>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await nextVersion(admin, projectId);
    const res = await admin.from("business_models").insert({ ...row, project_id: projectId, version }).select("*").single();
    if (res.error?.code === "23505") continue;
    return must(res);
  }
  throw conflict("다른 저장과 겹쳤다. 다시 저장한다");
}

/** 자료에서 Lean Canvas와 업무 목록 초안을 뽑아 새 버전으로 저장한다 */
export async function extractBusinessModel(admin: Db, projectId: string, userId: string, input: SourceInput) {
  const material = await gatherMaterial(admin, projectId, input);
  const llm = llmFor(admin, projectId, userId);
  const out = await llm.structured({ ...businessModelPrompt(material.text), images: material.images });
  const canvas = Object.fromEntries(CANVAS_FIELDS.map((f) => [f, cleanCell(out[f])])) as Canvas;
  const bm = await insertVersion(admin, projectId, { ...canvas, checks: normalizeChecks(canvas, out.checks), extracted_by_llm: true, created_by: userId });
  const tasks = must(
    await admin
      .from("tasks")
      .insert(out.tasks.map((t, i) => ({ project_id: projectId, business_model_id: bm.id, name: t.name, role: t.role, position: i })))
      .select("*"),
  );
  if (input.text) await admin.from("projects").update({ idea_text: input.text }).eq("id", projectId);
  return { business_model: bm, tasks, notes: material.notes };
}

// ── 칸별 가설과 자료 점검 (충분함·부족함·없음) ──────────────────────────
export type CheckLevel = "enough" | "weak" | "missing";
export interface StoredCheck extends CanvasCheck {
  /** 사용자가 고친 뒤 아직 다시 점검하지 않은 칸 */
  stale?: boolean;
}

/** 칸에 섞여 들어온 "자료에 없음" 같은 메모는 빈 칸으로 본다 */
function cleanCell(v: string | undefined): string {
  const t = (v ?? "").trim();
  return /^(자료에 없음|없음|확인 필요|해당 없음|n\/a|-)\.?$/i.test(t) ? "" : t;
}

/** 9칸마다 정확히 하나씩, 칸 순서대로. 빈 칸은 없음, 내용이 있는데 없음이라 하면 부족함으로 맞춘다 */
export function normalizeChecks(canvas: Partial<Canvas>, checks: CanvasCheck[] | undefined): StoredCheck[] {
  const by = new Map((checks ?? []).map((c) => [c.field, c] as const));
  return CANVAS_FIELDS.map((field) => {
    const c = by.get(field);
    const filled = !!(canvas[field] ?? "").trim();
    const status: CheckLevel = !filled ? "missing" : c?.status === "missing" || !c ? "weak" : c.status;
    return {
      field,
      hypothesis: c?.hypothesis?.trim() || "",
      status,
      found: filled ? (c?.found ?? "").trim() : "",
      gap: status === "enough" ? "" : (c?.gap ?? "").trim() || (filled ? "구체적인 대상·숫자·근거를 더 적는다" : "자료에 없다. 이 칸을 채울 내용을 확인한다"),
    };
  });
}

/** 고친 칸은 이전 점검을 그대로 믿지 않는다: 비우면 없음, 새로 채우면 부족함, 나머지는 그대로 두고 다시 점검 표시 */
function carryChecks(prev: StoredCheck[], before: Partial<Canvas>, after: Canvas): StoredCheck[] {
  const by = new Map(prev.map((c) => [c.field, c] as const));
  return CANVAS_FIELDS.map((field) => {
    const p = by.get(field);
    const changed = (before[field] ?? "") !== after[field];
    const filled = !!after[field].trim();
    if (!p) return { field, hypothesis: "", status: filled ? "weak" : "missing", found: "", gap: filled ? "다시 점검하면 가설과 부족한 점을 정리합니다" : "비어 있다", stale: filled };
    if (!changed) return p;
    if (!filled) return { ...p, status: "missing", found: "", gap: "비어 있다", stale: false };
    return { ...p, status: p.status === "missing" ? "weak" : p.status, stale: true };
  });
}

/** 지금 버전의 9칸을 LLM으로 다시 점검해 저장한다 (새 버전을 만들지 않는다) */
export async function recheckVersion(admin: Db, projectId: string, userId: string, version: number) {
  const bm = must(
    await admin.from("business_models").select("*").eq("project_id", projectId).eq("version", version).maybeSingle(),
    "사업 모델 버전",
  ) as Record<string, unknown> & { id: string };
  const canvas = Object.fromEntries(CANVAS_FIELDS.map((f) => [f, String(bm[f] ?? "")])) as Canvas;
  if (CANVAS_FIELDS.every((f) => !canvas[f].trim())) throw notFound("채워진 칸");
  const text = CANVAS_FIELDS.map((f) => `${f}: ${canvas[f] || "(비어 있음)"}`).join("\n");
  const out = await llmFor(admin, projectId, userId).structured(canvasCheckPrompt(text));
  const checks = normalizeChecks(canvas, out.checks);
  return must(await admin.from("business_models").update({ checks }).eq("id", bm.id).eq("project_id", projectId).select("*").single());
}

/** 사용자가 고친 사업 모델을 새 버전으로 저장 (덮어쓰지 않는다) */
export async function saveVersion(
  admin: Db,
  projectId: string,
  userId: string,
  input: Partial<Canvas> & { parent_version?: number; variant_label?: string; tasks?: { name: string; role: "practitioner" | "buyer" }[] },
) {
  let base: Partial<Canvas> & { checks?: StoredCheck[] } = {};
  if (input.parent_version) {
    const { data } = await admin
      .from("business_models")
      .select([...CANVAS_FIELDS, "checks"].join(","))
      .eq("project_id", projectId)
      .eq("version", input.parent_version)
      .maybeSingle();
    base = (data ?? {}) as Partial<Canvas> & { checks?: StoredCheck[] };
  }
  const canvas = Object.fromEntries(CANVAS_FIELDS.map((f) => [f, input[f] ?? base[f] ?? ""])) as Canvas;
  const bm = await insertVersion(admin, projectId, {
    parent_version: input.parent_version ?? null,
    variant_label: input.variant_label ?? null,
    ...canvas,
    checks: carryChecks(Array.isArray(base.checks) ? base.checks : [], base, canvas),
    edited_by_user: true,
    created_by: userId,
  });
  // 업무 목록을 보내지 않았을 때만 부모 버전(없으면 직전 버전)의 업무를 이어받는다. 빈 목록을 보내면 업무 없이 저장한다.
  let tasks = input.tasks;
  if (tasks === undefined) {
    const fromVersion = input.parent_version ?? Number(bm.version) - 1;
    const { data: prev } = await admin
      .from("business_models")
      .select("id, tasks(name, role, position)")
      .eq("project_id", projectId)
      .eq("version", fromVersion)
      .maybeSingle();
    tasks = ((prev?.tasks ?? []) as Array<{ name: string; role: "practitioner" | "buyer"; position: number }>)
      .sort((a, b) => a.position - b.position)
      .map(({ name, role }) => ({ name, role }));
  }
  if (tasks.length) {
    must(
      await admin
        .from("tasks")
        .insert(tasks.map((t, i) => ({ project_id: projectId, business_model_id: bm.id, name: t.name, role: t.role, position: i })))
        .select("id"),
    );
  }
  return bm;
}

/** 두 버전 또는 변형 아이디어 비교: 칸별로 바뀐 것만 */
export async function compareVersions(admin: Db, projectId: string, a: number, b: number) {
  const rows = must(
    await admin.from("business_models").select("*").eq("project_id", projectId).in("version", [a, b]),
  ) as Array<Record<string, unknown>>;
  const left = rows.find((r) => r.version === a);
  const right = rows.find((r) => r.version === b);
  if (!left || !right) return { a, b, changes: [], missing: true };
  const changes = CANVAS_FIELDS.filter((f) => (left[f] ?? "") !== (right[f] ?? "")).map((field) => ({
    field,
    a: left[field],
    b: right[field],
  }));
  return { a: left, b: right, changes };
}
