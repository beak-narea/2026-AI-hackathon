// 전사본 코딩 일치도 (기획 "LLM 판단의 신뢰도 척도 (3)").
// 내부 검증 세트의 구간을 LLM과 사람이 따로 코딩하고, 코드 유형마다 있음/없음으로 Krippendorff α를 계산한다.
// α ≥ 0.800 자동 적용, 0.667~0.800 사람 검토, 그 밖은 자동 적용하지 않는다. 고객 전사본 분석은 이 판정을 따른다.
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, must } from "../api/handler";
import { llmFor } from "../llm/factory";
import { codingPrompt } from "../llm/prompts";
import { gate, krippendorffAlpha, requiredUnits, type GateStatus } from "../reliability/agreement";

export const NONE = "없음";
/** 인터뷰 질문 분류 코드: 셋 다 자동 적용이 되어야 질문 품질 평가를 자동으로 쓴다 */
export const QUESTION_CODES = ["유도 질문", "미래 가정 질문", "과거 행동 질문"] as const;

export function splitSegments(text: string): string[] {
  const byBlank = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const parts = byBlank.length > 1 ? byBlank : text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  return parts.filter((s) => s.length >= 2).slice(0, 2000);
}

export async function createCodingSet(admin: Db, input: { name: string; code_types: string[]; text: string }) {
  const types = [...new Set(input.code_types.map((t) => t.trim()).filter((t) => t && t !== NONE))];
  if (!types.length) throw badRequest("코드 유형을 하나 이상 적는다");
  const segments = splitSegments(input.text);
  if (segments.length < 2) throw badRequest("구간이 2개 이상 필요하다 (빈 줄로 구간을 나눈다)");
  const set = must(await admin.from("coding_sets").insert({ name: input.name, code_types: types }).select("*").single());
  for (let i = 0; i < segments.length; i += 200) {
    const chunk = segments.slice(i, i + 200).map((text, j) => ({ set_id: set.id, idx: i + j + 1, text }));
    must(await admin.from("coding_segments").insert(chunk).select("id"));
  }
  return { set, segments: segments.length };
}

export async function addSegments(admin: Db, setId: string, text: string) {
  const { data: last } = await admin.from("coding_segments").select("idx").eq("set_id", setId).order("idx", { ascending: false }).limit(1).maybeSingle();
  const start = Number(last?.idx ?? 0);
  const segments = splitSegments(text);
  const rows = segments.map((t, j) => ({ set_id: setId, idx: start + j + 1, text: t }));
  if (rows.length) must(await admin.from("coding_segments").insert(rows).select("id"));
  return { added: rows.length };
}

/** LLM 코딩: 아직 LLM 라벨이 없는 구간만 40개씩 */
export async function runLlmCoding(admin: Db, setId: string, userId: string | null) {
  const set = must(await admin.from("coding_sets").select("*").eq("id", setId).maybeSingle(), "코딩 세트");
  const segs = must(await admin.from("coding_segments").select("id, idx, text, coding_labels(coder)").eq("set_id", setId).order("idx")) as Array<{
    id: string; idx: number; text: string; coding_labels: Array<{ coder: string }>;
  }>;
  const todo = segs.filter((s) => !s.coding_labels.some((l) => l.coder === "llm"));
  const llm = llmFor(admin, null, userId);
  const types = set.code_types as string[];
  let labeled = 0;
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const out = await llm.structured(codingPrompt(types, batch.map((s) => ({ idx: s.idx, text: s.text }))));
    const rows = batch.map((s) => {
      const got = out.labels.find((l) => l.idx === s.idx)?.code_type ?? NONE;
      return { segment_id: s.id, coder: "llm", code_type: types.includes(got) ? got : NONE };
    });
    must(await admin.from("coding_labels").upsert(rows, { onConflict: "segment_id,coder" }).select("id"));
    labeled += rows.length;
  }
  return { labeled };
}

/** 사람 코딩 화면: 이 사람이 아직 코딩하지 않은 구간 (LLM 라벨은 보여주지 않는다) */
export async function nextSegments(admin: Db, setId: string, coder: string, limit = 20) {
  const set = must(await admin.from("coding_sets").select("*").eq("id", setId).maybeSingle(), "코딩 세트");
  const segs = must(await admin.from("coding_segments").select("id, idx, text, coding_labels(coder)").eq("set_id", setId).order("idx")) as Array<{
    id: string; idx: number; text: string; coding_labels: Array<{ coder: string }>;
  }>;
  const mine = segs.filter((s) => s.coding_labels.some((l) => l.coder === coder)).length;
  return {
    set: { id: set.id, name: set.name, code_types: set.code_types },
    total: segs.length,
    done: mine,
    segments: segs.filter((s) => !s.coding_labels.some((l) => l.coder === coder)).slice(0, limit).map(({ id, idx, text }) => ({ id, idx, text })),
  };
}

export async function labelSegments(admin: Db, setId: string, coder: string, labels: Array<{ segment_id: string; code_type: string }>) {
  const set = must(await admin.from("coding_sets").select("code_types").eq("id", setId).maybeSingle(), "코딩 세트");
  const allowed = new Set([...(set.code_types as string[]), NONE]);
  for (const l of labels) if (!allowed.has(l.code_type)) throw badRequest(`정의되지 않은 코드: ${l.code_type}`);
  const ids = labels.map((l) => l.segment_id);
  const { data: segs } = await admin.from("coding_segments").select("id").eq("set_id", setId).in("id", ids);
  if ((segs ?? []).length !== new Set(ids).size) throw badRequest("이 세트의 구간이 아니다");
  must(await admin.from("coding_labels").upsert(labels.map((l) => ({ ...l, coder })), { onConflict: "segment_id,coder" }).select("id"));
  return { saved: labels.length };
}

/** 모든 코딩 세트를 모아 코드 유형별 α를 계산하고 자동 적용 여부를 저장한다 */
export async function computeCodeTypeStatus(admin: Db) {
  const sets = must(await admin.from("coding_sets").select("id, code_types")) as Array<{ id: string; code_types: string[] }>;
  const perType = new Map<string, Array<Array<0 | 1 | null>>>(); // code_type → 단위별 [llm, human1, human2...]
  for (const set of sets) {
    const segs = must(await admin.from("coding_segments").select("id, coding_labels(coder, code_type)").eq("set_id", set.id)) as Array<{
      id: string; coding_labels: Array<{ coder: string; code_type: string }>;
    }>;
    const humans = [...new Set(segs.flatMap((s) => s.coding_labels.map((l) => l.coder)).filter((c) => c !== "llm"))];
    for (const type of set.code_types) {
      if (!perType.has(type)) perType.set(type, []);
      for (const s of segs) {
        const llm = s.coding_labels.find((l) => l.coder === "llm");
        const hs = humans.map((h) => s.coding_labels.find((l) => l.coder === h));
        if (!llm || !hs.some(Boolean)) continue; // LLM과 사람 1명 이상이 함께 코딩한 구간만
        perType.get(type)!.push([llm.code_type === type ? 1 : 0, ...hs.map((h) => (h ? (h.code_type === type ? 1 : 0) : null))]);
      }
    }
  }
  const results: Array<{ code_type: string; alpha: number | null; n_units: number; required: number; status: GateStatus }> = [];
  for (const [code_type, units] of perType) {
    const width = Math.max(0, ...units.map((u) => u.length));
    const matrix = Array.from({ length: width }, (_, c) => units.map((u) => (u[c] === undefined ? null : u[c]!)));
    const alpha = units.length ? krippendorffAlpha(matrix, "nominal", [0, 1]) : null;
    const required = requiredUnits(2);
    const status = gate(alpha, units.length, required);
    results.push({ code_type, alpha, n_units: units.length, required, status });
    await admin.from("code_type_status").upsert({ code_type, alpha, n_units: units.length, required, status, computed_at: new Date().toISOString() }, { onConflict: "code_type" });
  }
  return { code_types: results };
}

export async function listCoding(admin: Db) {
  const [sets, status] = await Promise.all([
    admin.from("coding_sets").select("id, name, code_types, created_at, coding_segments(id)").order("created_at", { ascending: false }),
    admin.from("code_type_status").select("*").order("code_type"),
  ]);
  return {
    sets: (sets.data ?? []).map((s: { coding_segments: unknown[] } & Record<string, unknown>) => ({ ...s, segments: s.coding_segments.length, coding_segments: undefined })),
    status: status.data ?? [],
  };
}

/** 고객 전사본 분석에 쓰는 판정 */
export async function codeGates(admin: Db): Promise<{ status: Record<string, GateStatus>; questionsValidated: boolean }> {
  const { data } = await admin.from("code_type_status").select("code_type, status");
  const status = Object.fromEntries((data ?? []).map((r: { code_type: string; status: GateStatus }) => [r.code_type, r.status]));
  return { status, questionsValidated: QUESTION_CODES.every((c) => status[c] === "auto") };
}
