// 의사결정: 서비스는 권고와 근거, 최종 결정은 고객 팀이 사유 유형과 함께 기록한다.
// 가설 상태는 여기서만 바뀐다 (판정 → 결정 → 상태).
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must } from "../api/handler";
import {
  hypothesisStatusAfterDecision, isGroundedChange, recommend,
  type Criticality, type DecisionChoice, type EvidenceLevel, type HypothesisType, type ReasonType,
} from "../domain/rules";
import { isUsageMethod, methodsFor } from "../domain/experiments";
import type { VerdictResult } from "../stats/verdict";
import { archiveProject } from "./projects";

export async function recommendation(admin: Db, projectId: string, hypothesisId: string) {
  const h = must(await admin.from("hypotheses").select("*").eq("id", hypothesisId).eq("project_id", projectId).maybeSingle(), "가설");
  const verdicts = must(
    await admin.from("verdicts").select("*").eq("hypothesis_id", hypothesisId).order("created_at", { ascending: false }),
  ) as Array<{ id: string; result: VerdictResult; root_proposal_id: string; evidence_level: EvidenceLevel }>;
  const latest = verdicts[0];
  if (!latest) return { verdict: null, recommendation: null };
  // 치명 가설의 미달: 다른 제안(다른 방법)에서 이미 미달이 나왔으면 확인 실험을 한 것으로 본다
  const confirmationDone = verdicts.some((v) => v.result === "not_met" && v.root_proposal_id !== latest.root_proposal_id);
  return { verdict: latest, recommendation: recommend(latest.result, h.criticality as Criticality | null, confirmationDone) };
}

export interface DecisionInput {
  hypothesis_id: string;
  verdict_id?: string | null;
  choice: DecisionChoice;
  reason_type: ReasonType;
  note?: string;
}

export async function recordDecision(admin: Db, projectId: string, userId: string, input: DecisionInput) {
  const h = must(await admin.from("hypotheses").select("*").eq("id", input.hypothesis_id).eq("project_id", projectId).maybeSingle(), "가설");
  const rec = await recommendation(admin, projectId, h.id);
  let verdict: { id: string; result: VerdictResult; evidence_level: EvidenceLevel; proposal_id: string } | null = null;
  if (input.verdict_id) {
    verdict = must(await admin.from("verdicts").select("*").eq("id", input.verdict_id).eq("hypothesis_id", h.id).maybeSingle(), "판정");
    // 결정은 그 가설의 가장 최근 판정에만 연결한다 (옛 충족 판정을 골라 새 미달을 덮지 못하게)
    const latest = rec.verdict as { id: string } | null;
    if (latest && latest.id !== verdict.id) throw conflict("더 최근 판정이 있다. 최근 판정으로 결정한다", { latest_verdict_id: latest.id });
  } else if (input.reason_type === "evidence") {
    throw badRequest("사유가 '증거'인 결정은 판정을 연결해야 한다");
  }

  const grounded = isGroundedChange({
    choice: input.choice,
    reasonType: input.reason_type,
    verdictResult: verdict?.result ?? null,
    verdictEvidenceLevel: verdict?.evidence_level ?? null,
    linkedToHypothesisAndEvidence: !!verdict,
  });

  const decision = must(
    await admin
      .from("decisions")
      .insert({
        project_id: projectId,
        hypothesis_id: h.id,
        verdict_id: verdict?.id ?? null,
        recommendation: rec.recommendation?.recommendation ?? input.choice,
        rationale: rec.recommendation?.rationale ?? "판정 없이 내린 결정",
        choice: input.choice,
        reason_type: input.reason_type,
        note: input.note ?? "",
        decided_by: userId,
        is_grounded_change: grounded,
      })
      .select("*")
      .single(),
  );

  if (verdict) {
    const status = hypothesisStatusAfterDecision(verdict.result, input.choice);
    // 결정은 이미 저장됐다. 가설 상태 갱신이 실패하면 다시 시도할 수 있게 알린다
    must(await admin.from("hypotheses").update({ status }).eq("id", h.id).eq("project_id", projectId).select("id"), "가설");
  }

  const followUp: Record<string, unknown> = {};
  switch (input.choice) {
    case "continue": {
      // 출시 뒤에도 같은 틀: 충족한 가설을 실사용 지표 기획서로 다시 잰다
      const { data: proposal } = verdict ? await admin.from("proposals").select("method_key").eq("id", verdict.proposal_id).maybeSingle() : { data: null };
      if (verdict?.result === "met" && proposal && !isUsageMethod(proposal.method_key as string)) {
        const usage = methodsFor(h.type as HypothesisType, false).find((m) => m.usage);
        if (usage) {
          followUp.next_screen = "proposals";
          followUp.next_query = `hypothesis=${h.id}&method=${usage.key}`;
          followUp.suggested_method = usage.key;
          break;
        }
      }
      followUp.next_screen = "hypotheses";
      break;
    }
    case "more_validation":
      followUp.next_screen = "proposal";
      followUp.next_action = verdict?.result === "on_hold" ? "verdict.rejudge" : "proposal.generate";
      break;
    case "revise":
      followUp.next_screen = "hypotheses";
      followUp.alternatives = ["hypotheses", "business_model"];
      break;
    case "stop":
      followUp.project = await archiveProject(admin, projectId, input.note || "의사결정: 중단");
      followUp.next_screen = "archive";
      break;
  }
  return { decision, is_grounded_change: grounded, ...followUp };
}
