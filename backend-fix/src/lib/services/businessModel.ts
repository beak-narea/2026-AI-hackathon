import "server-only";
import type { Db } from "../supabase/server";
import { conflict, must } from "../api/handler";
import { llmFor } from "../llm/factory";
import { businessModelPrompt } from "../llm/prompts";
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
  const canvas = Object.fromEntries(CANVAS_FIELDS.map((f) => [f, out[f]])) as Canvas;
  const bm = await insertVersion(admin, projectId, { ...canvas, extracted_by_llm: true, created_by: userId });
  const tasks = must(
    await admin
      .from("tasks")
      .insert(out.tasks.map((t, i) => ({ project_id: projectId, business_model_id: bm.id, name: t.name, role: t.role, position: i })))
      .select("*"),
  );
  if (input.text) await admin.from("projects").update({ idea_text: input.text }).eq("id", projectId);
  return { business_model: bm, tasks, missing: out.missing, notes: material.notes };
}

/** 사용자가 고친 사업 모델을 새 버전으로 저장 (덮어쓰지 않는다) */
export async function saveVersion(
  admin: Db,
  projectId: string,
  userId: string,
  input: Partial<Canvas> & { parent_version?: number; variant_label?: string; tasks?: { name: string; role: "practitioner" | "buyer" }[] },
) {
  let base: Partial<Canvas> = {};
  if (input.parent_version) {
    const { data } = await admin
      .from("business_models")
      .select(CANVAS_FIELDS.join(","))
      .eq("project_id", projectId)
      .eq("version", input.parent_version)
      .maybeSingle();
    base = (data ?? {}) as Partial<Canvas>;
  }
  const canvas = Object.fromEntries(CANVAS_FIELDS.map((f) => [f, input[f] ?? base[f] ?? ""]));
  const bm = await insertVersion(admin, projectId, {
    parent_version: input.parent_version ?? null,
    variant_label: input.variant_label ?? null,
    ...canvas,
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
