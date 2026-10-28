// 진단: 4구역 판정(1번), 자동화 선호(2번), 대체 위험(3번). LLM은 질문과 근거 초안만 쓴다.
import "server-only";
import type { Db } from "../supabase/server";
import { must, notFound } from "../api/handler";
import { llmFor } from "../llm/factory";
import { DiagnosisDrafts, diagnosisPrompt } from "../llm/prompts";
import type { z } from "zod";
import {
  automationZone, isCriticalCandidate, levelAtLeast, wrapperRisk, WRAPPER_ITEMS,
  type EvidenceLevel, type TriStatus, type WrapperItemKey,
} from "../domain/rules";
import type { VerdictResult } from "../stats/verdict";
import { serverEnv } from "../env";
import { embed, toPgVector } from "../llm/embeddings";

/** WORKBank에서 의미가 가장 비슷한 업무의 자동화 희망 점수 (미국 노동자 설문, 참고용 추정) */
async function demandPrior(admin: Db, taskName: string): Promise<{ score: number; task: string } | null> {
  const env = serverEnv();
  try {
    const vectors = await embed([taskName], env.VOYAGE_API_KEY, env.VOYAGE_MODEL, "query");
    if (!vectors) return null;
    const { data } = await admin.rpc("match_workbank", { query_embedding: toPgVector(vectors[0]!), match_count: 1 });
    const best = (data as Array<{ task_statement: string; automation_desire: number; similarity: number }> | null)?.[0];
    if (!best || best.automation_desire === null || best.similarity < 0.5) return null;
    return { score: Number(best.automation_desire), task: best.task_statement };
  } catch {
    return null; // 참고값이므로 실패해도 진단은 계속한다
  }
}

export async function latestBusinessModel(admin: Db, projectId: string) {
  const { data } = await admin
    .from("business_models")
    .select("*")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw notFound("사업 모델");
  return data as Record<string, unknown> & { id: string; version: number };
}

export function canvasText(bm: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    problem: "문제", customer_segments: "고객", unique_value_proposition: "가치 제안", solution: "해결책",
    channels: "채널", revenue_streams: "수익", cost_structure: "비용", key_metrics: "핵심 지표", unfair_advantage: "경쟁 우위",
  };
  const canvas = Object.entries(labels)
    .map(([k, l]) => `${l}: ${(bm[k] as string) || "(비어 있음)"}`)
    .join("\n");
  // 칸별 자료 점검에서 부족함·없음인 가설은 위험한 가정 후보로 함께 넘긴다
  const level: Record<string, string> = { enough: "충분함", weak: "부족함", missing: "없음" };
  const checks = (Array.isArray(bm.checks) ? bm.checks : []) as Array<{ field: string; hypothesis?: string; status?: string; gap?: string }>;
  const weak = checks.filter((c) => c.status === "weak" || c.status === "missing");
  if (!weak.length) return canvas;
  return `${canvas}\n\n[자료 점검에서 근거가 부족하거나 없는 가설]\n${weak
    .map((c) => `- ${labels[c.field] ?? c.field} (${level[c.status ?? ""] ?? c.status}): ${c.hypothesis ?? ""}${c.gap ? ` / ${c.gap}` : ""}`)
    .join("\n")}`;
}

/** 최신 사업 모델의 업무마다 진단을 만든다 (구역은 결과가 오기 전까지 비어 있다) */
export async function runDiagnosis(admin: Db, projectId: string, userId: string) {
  const bm = await latestBusinessModel(admin, projectId);
  const tasks = must(
    await admin.from("tasks").select("*").eq("business_model_id", bm.id).order("position"),
  ) as Array<{ id: string; name: string; role: string }>;
  const llm = llmFor(admin, projectId, userId);
  const text = canvasText(bm);
  // 이 사업 모델 버전에서 이미 진단한 업무는 건너뛴다 (다시 눌러도 같은 진단이 쌓이지 않게)
  const { data: done } = await admin.from("diagnoses").select("task_id").eq("business_model_id", bm.id);
  const doneTasks = new Set(((done ?? []) as Array<{ task_id: string }>).map((d) => d.task_id));
  const todo = tasks.filter((t) => t.role === "practitioner" && !doneTasks.has(t.id));
  // 업무별 LLM 호출은 4개씩 함께 (라우트 시간 제한 안에 끝나게)
  const allDrafts: Array<z.infer<typeof DiagnosisDrafts>> = new Array(todo.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, todo.length) }, async () => {
      while (next < todo.length) {
        const i = next++;
        allDrafts[i] = await llm.structured(diagnosisPrompt(text, todo[i]!.name));
      }
    }),
  );
  const results = [];
  for (const [i, task] of todo.entries()) {
    const drafts = allDrafts[i]!;
    const prior = await demandPrior(admin, task.name);
    const diagnosis = must(
      await admin
        .from("diagnoses")
        .insert({
          project_id: projectId,
          task_id: task.id,
          business_model_id: bm.id,
          confirmation_questions: drafts.confirmation_questions,
          demand_prior: prior?.score ?? null,
          demand_prior_task: prior ? `${prior.task} (WORKBank 유사 업무, 참고용)` : null,
        })
        .select("*")
        .single(),
    );
    // LLM이 같은 항목을 두 번 쓰거나 빠뜨려도 항목마다 정확히 한 줄 (DB는 항목당 하나만 받는다)
    const byKey = new Map(drafts.wrapper_evidence.map((w) => [w.item_key, w] as const).reverse());
    const inserted = await admin
      .from("wrapper_items")
      .insert(
        WRAPPER_ITEMS.map((key) => {
          const w = byKey.get(key);
          return {
            project_id: projectId,
            diagnosis_id: diagnosis.id,
            item_key: key,
            status: "unknown",
            evidence_note: w ? `${w.evidence_note}\n확인 방법: ${w.how_to_check}` : "자료에 없음",
          };
        }),
      )
      .select("*");
    if (inserted.error) {
      // 체크리스트 없는 진단이 남으면 다음 실행에서 "이미 진단함"으로 건너뛰어 영영 비게 된다
      await admin.from("diagnoses").delete().eq("id", diagnosis.id).eq("project_id", projectId);
    }
    const items = must(inserted);
    results.push({ diagnosis, wrapper_items: items, task });
  }
  return { business_model_version: bm.version, diagnoses: results, already_diagnosed: doneTasks.size };
}

export interface DiagnosisUpdate {
  agency_assumed?: "H1" | "H2" | "H3" | "H4" | "H5" | null;
  agency_observed?: "H1" | "H2" | "H3" | "H4" | "H5" | null;
  /** 사용자가 판정한 체크리스트 항목 */
  wrapper_items?: { item_key: WrapperItemKey; status: TriStatus; evidence_note?: string; evidence_url?: string | null }[];
  /** 가능성 축·수요 축 결과 (해당 가설의 판정에서 가져오거나, 결과 판정 화면에서 연결) */
  feasibility?: { verdict: VerdictResult | null; level: EvidenceLevel };
  demand?: { verdict: VerdictResult | null; level: EvidenceLevel };
  /** 구매자(돈 내는 사람) 수요. 실무자 수요와 엇갈리면 경고 */
  buyer_demand?: { verdict: VerdictResult | null; level: EvidenceLevel };
  demand_prior?: number | null;
  demand_prior_task?: string | null;
}

/** 진단 갱신: 구역·잠정 표시·대체 위험 등급은 코드가 다시 계산한다 */
export async function updateDiagnosis(admin: Db, projectId: string, diagnosisId: string, input: DiagnosisUpdate) {
  const current = must(
    await admin.from("diagnoses").select("*").eq("id", diagnosisId).eq("project_id", projectId).maybeSingle(),
    "진단",
  );
  for (const item of input.wrapper_items ?? []) {
    must(
      await admin
        .from("wrapper_items")
        .update({
          status: item.status,
          ...(item.evidence_note !== undefined ? { evidence_note: item.evidence_note } : {}),
          ...(item.evidence_url !== undefined ? { evidence_url: item.evidence_url } : {}),
        })
        .eq("diagnosis_id", diagnosisId)
        .eq("project_id", projectId)
        .eq("item_key", item.item_key)
        .select("id"),
    );
  }
  const items = must(await admin.from("wrapper_items").select("item_key, status").eq("diagnosis_id", diagnosisId).eq("project_id", projectId)) as Array<{
    item_key: WrapperItemKey;
    status: TriStatus;
  }>;
  const statusMap = Object.fromEntries(items.map((i) => [i.item_key, i.status]));
  const risk = items.some((i) => i.status !== "unknown") || current.baseline_result
    ? wrapperRisk(statusMap, current.baseline_result)
    : null;

  const feasibility = input.feasibility ?? {
    verdict: (current.feasibility_verdict as VerdictResult | null) ?? current.baseline_result,
    level: current.feasibility_level as EvidenceLevel,
  };
  const demand = input.demand ?? { verdict: current.demand_verdict as VerdictResult | null, level: current.demand_level as EvidenceLevel };
  const buyer = input.buyer_demand ?? { verdict: current.buyer_demand_verdict as VerdictResult | null, level: current.buyer_demand_level as EvidenceLevel };
  const zone = automationZone(feasibility, demand);

  const updated = must(
    await admin
      .from("diagnoses")
      .update({
        zone: zone.zone,
        is_provisional: zone.provisional || !levelAtLeast(feasibility.level, "L2") || !levelAtLeast(demand.level, "L2"),
        feasibility_level: feasibility.level,
        demand_level: demand.level,
        feasibility_verdict: feasibility.verdict,
        demand_verdict: demand.verdict,
        buyer_demand_verdict: buyer.verdict,
        buyer_demand_level: buyer.level,
        wrapper_risk: risk,
        ...(input.agency_assumed !== undefined ? { agency_assumed: input.agency_assumed } : {}),
        ...(input.agency_observed !== undefined ? { agency_observed: input.agency_observed } : {}),
        ...(input.demand_prior !== undefined ? { demand_prior: input.demand_prior } : {}),
        ...(input.demand_prior_task !== undefined ? { demand_prior_task: input.demand_prior_task } : {}),
      })
      .eq("id", diagnosisId)
      .select("*")
      .single(),
  );

  // 빨간불·래퍼 위험 높음은 연결된 가설을 "치명" 후보로 표시
  if (isCriticalCandidate({ zone: zone.zone, wrapperRisk: risk })) {
    await admin.from("hypotheses").update({ critical_candidate: true }).eq("diagnosis_id", diagnosisId).eq("project_id", projectId);
  }

  // 자동화 선호: 제품은 H1인데 실제로 사람 검토를 고르면 가설 제안
  const suggestions: string[] = [];
  const order = ["H1", "H2", "H3", "H4", "H5"];
  if (updated.agency_assumed && updated.agency_observed && order.indexOf(updated.agency_observed) > order.indexOf(updated.agency_assumed)) {
    suggestions.push("고객이 제품 설계보다 사람의 개입을 더 원한다. '검토·승인 단계 추가' 가설을 만든다.");
  }
  if (buyer.verdict && demand.verdict && ((buyer.verdict === "met" && demand.verdict === "not_met") || (buyer.verdict === "not_met" && demand.verdict === "met"))) {
    suggestions.push("실무자 수요와 구매자 수요가 엇갈린다. 쓰는 사람과 돈 내는 사람의 가치 제안을 따로 세운다.");
  }
  return { diagnosis: updated, wrapper_items: items, suggestions };
}

export type DiagnosisAxis = "feasibility" | "demand" | "buyer_demand";

/** 가설 유형으로 진단 축을 짐작한다 (가설에 축을 직접 지정하지 않았을 때) */
export function axisForType(type: string): DiagnosisAxis | null {
  if (type === "feasibility" || type === "accuracy") return "feasibility";
  if (type === "demand") return "demand";
  if (type === "payment") return "buyer_demand";
  return null;
}

/** 4구역 자동 갱신: 진단에 연결된 가설이 판정을 받으면 해당 축 값을 채우고 구역을 다시 계산한다 */
export async function applyAxisVerdict(
  admin: Db,
  projectId: string,
  hypothesisId: string,
  verdict: { result: VerdictResult; evidence_level: EvidenceLevel },
) {
  const { data: h } = await admin.from("hypotheses").select("diagnosis_id, diagnosis_axis, type").eq("id", hypothesisId).eq("project_id", projectId).maybeSingle();
  if (!h?.diagnosis_id) return null;
  const axis = (h.diagnosis_axis as DiagnosisAxis | null) ?? axisForType(h.type as string);
  if (!axis) return null;
  const state = { verdict: verdict.result, level: verdict.evidence_level };
  return updateDiagnosis(admin, projectId, h.diagnosis_id as string, axis === "feasibility" ? { feasibility: state } : axis === "demand" ? { demand: state } : { buyer_demand: state });
}
