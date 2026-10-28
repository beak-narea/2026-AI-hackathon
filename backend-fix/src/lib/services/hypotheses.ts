// 5번 기능: AI 특화 가설과 위험 가정 순위. 중요도는 팀원이 독립적으로 매기고, LLM은 반대 평가자로만 참여한다.
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, must } from "../api/handler";
import { llmFor } from "../llm/factory";
import { devilsAdvocatePrompt, hypothesisPrompt } from "../llm/prompts";
import { canvasText, latestBusinessModel } from "./diagnosis";
import {
  compareHypotheses, criticalityConsensus, isCriticalCandidate,
  type Criticality, type EvidenceLevel, type HypothesisType, type Rating,
} from "../domain/rules";

type HypRow = {
  id: string;
  statement: string;
  type: HypothesisType;
  criticality: Criticality | null;
  evidence_level: EvidenceLevel;
  status: string;
  rank: number | null;
  critical_candidate: boolean;
  diagnosis_id: string | null;
};

async function diagnosisSummary(admin: Db, projectId: string): Promise<{ text: string; candidateDiagnosis: string | null; negativeMargin: boolean }> {
  const { data: diags } = await admin
    .from("diagnoses")
    .select("id, zone, wrapper_risk, agency_assumed, agency_observed, is_provisional, tasks(name)")
    .eq("project_id", projectId);
  const { data: cost } = await admin
    .from("cost_models")
    .select("results")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const margin = (cost?.results as { margin?: number } | undefined)?.margin ?? null;
  const lines = (diags ?? []).map(
    (d: Record<string, unknown>) =>
      `- 업무 "${(d.tasks as { name?: string } | null)?.name ?? "?"}": 구역=${d.zone ?? "미확인"}${d.is_provisional ? "(잠정)" : ""}, 래퍼 위험=${d.wrapper_risk ?? "미확인"}, 자동화 선호(가정/관측)=${d.agency_assumed ?? "?"}/${d.agency_observed ?? "?"}`,
  );
  if (margin !== null) lines.push(`- 사용자당 평균 월 마진: ${Math.round(margin)}원`);
  const candidate = (diags ?? []).find((d: Record<string, unknown>) =>
    isCriticalCandidate({ zone: d.zone as never, wrapperRisk: d.wrapper_risk as never }),
  ) as { id: string } | undefined;
  return { text: lines.join("\n") || "(진단 없음)", candidateDiagnosis: candidate?.id ?? null, negativeMargin: margin !== null && margin < 0 };
}

/** 사전 부검으로 가설 초안을 만든다 (중요도는 비워 둔다) */
export async function draftHypotheses(admin: Db, projectId: string, userId: string) {
  const bm = await latestBusinessModel(admin, projectId);
  const summary = await diagnosisSummary(admin, projectId);
  const llm = llmFor(admin, projectId, userId);
  const out = await llm.structured(hypothesisPrompt(canvasText(bm), summary.text));
  const { data: cost } = await admin.from("cost_models").select("id").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const rows = must(
    await admin
      .from("hypotheses")
      .insert(
        out.hypotheses.map((h) => ({
          project_id: projectId,
          statement: h.statement,
          type: h.type,
          premortem_reason: `${h.premortem_reason}\n틀리면: ${h.if_wrong}`,
          drafted_by_llm: true,
          diagnosis_id: summary.candidateDiagnosis,
          cost_model_id: cost?.id ?? null,
          critical_candidate: summary.candidateDiagnosis !== null || (summary.negativeMargin && h.type === "payment"),
        })),
      )
      .select("*"),
  );
  return { premortem: out.premortem, hypotheses: rows };
}

export async function createHypothesis(admin: Db, projectId: string, input: { statement: string; type: HypothesisType; premortem_reason?: string }) {
  return must(
    await admin
      .from("hypotheses")
      .insert({ project_id: projectId, statement: input.statement, type: input.type, premortem_reason: input.premortem_reason ?? null })
      .select("*")
      .single(),
  );
}

/** 팀원·외부 평가자의 독립 평정. 모두 같으면 합의 값으로, 다르면 토론 표시. */
export async function rateCriticality(
  admin: Db,
  projectId: string,
  hypothesisId: string,
  rater: { userId: string; name: string; type: "team" | "external" },
  level: Criticality,
  note: string,
) {
  const h = must(await admin.from("hypotheses").select("id").eq("id", hypothesisId).eq("project_id", projectId).maybeSingle(), "가설");
  const { error } = await admin.from("criticality_ratings").upsert(
    { project_id: projectId, hypothesis_id: h.id, rater_user_id: rater.userId, rater_name: rater.name, rater_type: rater.type, level, note },
    { onConflict: "hypothesis_id,rater_user_id" },
  );
  if (error) throw error;
  return refreshConsensus(admin, hypothesisId);
}

export async function refreshConsensus(admin: Db, hypothesisId: string) {
  const ratings = must(
    await admin.from("criticality_ratings").select("id, rater_type, level").eq("hypothesis_id", hypothesisId),
  ) as Array<{ id: string; rater_type: Rating["raterType"]; level: Criticality }>;
  const c = criticalityConsensus(ratings.map((r) => ({ raterType: r.rater_type, level: r.level })));
  if (c.consensus) await admin.from("hypotheses").update({ criticality: c.consensus }).eq("id", hypothesisId);
  const llm = ratings.find((r) => r.rater_type === "llm");
  if (llm) await admin.from("criticality_ratings").update({ needs_review: c.llmFlagReview }).eq("id", llm.id);
  return c;
}

/** 팀이 토론 뒤 확정 (사람 평정이 엇갈렸을 때) */
export async function settleCriticality(admin: Db, projectId: string, hypothesisId: string, level: Criticality) {
  must(await admin.from("hypotheses").select("id").eq("id", hypothesisId).eq("project_id", projectId).maybeSingle(), "가설");
  const c = await refreshConsensus(admin, hypothesisId);
  if (level === "critical" && c.needsExternalRater) {
    throw badRequest("'치명' 가정은 팀 밖 평가자 1명이 함께 매겨야 확정할 수 있다");
  }
  return must(
    await admin.from("hypotheses").update({ criticality: level }).eq("id", hypothesisId).eq("project_id", projectId).select("*").single(),
  );
}

/** LLM 반대 평가자: 사람 평정과 2단계 차이가 나는 항목만 "재검토" (α 계산에는 넣지 않는다) */
export async function runDevilsAdvocate(admin: Db, projectId: string, userId: string) {
  const bm = await latestBusinessModel(admin, projectId);
  const hyps = must(await admin.from("hypotheses").select("id, statement").eq("project_id", projectId)) as Array<{ id: string; statement: string }>;
  if (!hyps.length) throw badRequest("가설이 없다");
  const llm = llmFor(admin, projectId, userId);
  const out = await llm.structured(devilsAdvocatePrompt(canvasText(bm), hyps));
  const valid = new Set(hyps.map((h) => h.id));
  const flagged: string[] = [];
  for (const r of out.ratings.filter((r) => valid.has(r.hypothesis_id))) {
    await admin.from("criticality_ratings").delete().eq("hypothesis_id", r.hypothesis_id).eq("rater_type", "llm");
    await admin.from("criticality_ratings").insert({
      project_id: projectId,
      hypothesis_id: r.hypothesis_id,
      rater_name: "LLM 반대 평가자",
      rater_type: "llm",
      level: r.level,
      note: r.rationale,
    });
    const c = await refreshConsensus(admin, r.hypothesis_id);
    if (c.llmFlagReview) flagged.push(r.hypothesis_id);
  }
  return { rated: out.ratings.length, needs_review: flagged };
}

/** 가정 매핑 순서: 중요도 → 증거가 약한 것 (곱하지 않는다) */
export async function reorder(admin: Db, projectId: string) {
  const hyps = must(await admin.from("hypotheses").select("*").eq("project_id", projectId)) as HypRow[];
  const sorted = [...hyps].sort((a, b) =>
    compareHypotheses(
      { criticality: a.criticality, evidenceLevel: a.evidence_level },
      { criticality: b.criticality, evidenceLevel: b.evidence_level },
    ),
  );
  for (const [i, h] of sorted.entries()) {
    if (h.rank !== i + 1) await admin.from("hypotheses").update({ rank: i + 1 }).eq("id", h.id);
  }
  return sorted.map((h, i) => ({ id: h.id, rank: i + 1 }));
}

/**
 * 가설 화면: 순위, 평정, 합의 상태, 바깥 관점.
 * 블라인드 평정: 평정할 수 있는 사람(팀원·외부 평가자)이 아직 매기지 않은 가정은 다른 사람의 평정 내용을 보내지 않는다.
 */
export async function listHypotheses(admin: Db, projectId: string, viewer: { userId: string | null; canRate: boolean } = { userId: null, canRate: false }) {
  const hyps = must(await admin.from("hypotheses").select("*").eq("project_id", projectId)) as HypRow[];
  const ratings = must(
    await admin.from("criticality_ratings").select("*").eq("project_id", projectId),
  ) as Array<{ hypothesis_id: string; rater_type: Rating["raterType"]; level: Criticality; rater_name: string; note: string; needs_review: boolean }>;
  const types = [...new Set(hyps.map((h) => h.type))];
  const outside: Record<string, { fail_rate: number; judged: number; companies: number } | null> = {};
  for (const t of types) {
    const { data } = await admin.rpc("outside_view", { t });
    outside[t] = (data as Array<{ fail_rate: number; judged: number; companies: number }> | null)?.[0] ?? null;
  }
  return hyps
    .sort((a, b) =>
      compareHypotheses(
        { criticality: a.criticality, evidenceLevel: a.evidence_level },
        { criticality: b.criticality, evidenceLevel: b.evidence_level },
      ),
    )
    .map((h) => {
      const rs = ratings.filter((r) => r.hypothesis_id === h.id);
      const mine = rs.some((r) => (r as { rater_user_id?: string | null }).rater_user_id === viewer.userId);
      const hidden = viewer.canRate && !mine;
      const consensus = criticalityConsensus(rs.map((r) => ({ raterType: r.rater_type, level: r.level })));
      return {
        ...h,
        // 내가 매기기 전에는 팀 합의 값도 숨긴다 (먼저 본 값에 끌려가지 않게)
        criticality: hidden ? null : h.criticality,
        ratings: hidden ? [] : rs,
        ratings_hidden: hidden ? rs.length : 0,
        consensus: hidden ? { ...consensus, consensus: null, needsDiscussion: false, llmFlagReview: false } : consensus,
        outside_view: outside[h.type] ?? null,
      };
    });
}
