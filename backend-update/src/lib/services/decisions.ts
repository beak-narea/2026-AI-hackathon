// 의사결정: 서비스는 권고와 근거, 최종 결정은 고객 팀이 사유 유형과 함께 기록한다.
// 가설 상태는 여기서만 바뀐다 (판정 → 결정 → 상태).
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, must } from "../api/handler";
import {
  hypothesisStatusAfterDecision, isGroundedChange, recommend,
  type Criticality, type DecisionChoice, type EvidenceLevel, type ReasonType,
} from "../domain/rules";
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
    await admin.from("hypotheses").update({ status }).eq("id", h.id);
  }

  const followUp: Record<string, unknown> = {};
  switch (input.choice) {
    case "continue": {
      if (verdict?.result === "met") {
        const proposal = must(await admin.from("proposals").select("*").eq("id", verdict.proposal_id).maybeSingle(), "검증 제안");
        const card = must(
          await admin
            .from("metric_cards")
            .insert({
              project_id: projectId,
              hypothesis_id: h.id,
              event_name: suggestEventName(proposal.method_key),
              definition: `${h.statement}. 출시 후에도 같은 행동을 잰다`,
              target_value: proposal.target_value,
              min_value: proposal.min_value,
              alert_rule: "월간 판정이 미달이면 알림",
            })
            .select("*")
            .single(),
        );
        followUp.metric_card = card;
        followUp.note = "출시 전 지표와 출시 후 지표의 정의가 다르면 목표값·최소 허용치를 다시 정한 뒤 잠근다.";
      }
      followUp.next_screen = "post_launch";
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

function suggestEventName(methodKey: string): string {
  const map: Record<string, string> = {
    fake_door: "ai_feature_used",
    fake_door_pair: "ai_mode_selected",
    b2b_followup_meeting: "ai_feature_used",
    b2b_mode_choice: "ai_mode_selected",
    wizard_of_oz: "ai_output_accepted_unedited",
    design_partner_usage: "ai_output_accepted_unedited",
    concierge_accuracy: "ai_output_adopted",
    paid_pilot: "subscription_paid",
    landing_deposit: "subscription_paid",
    data_sample_request: "customer_data_connected",
    data_sample_baseline: "ai_output_correct",
    paid_poc: "ai_output_correct",
  };
  return map[methodKey] ?? "validated_behavior";
}
