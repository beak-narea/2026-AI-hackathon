// 검증 제안 = "검증 실험 및 MVP 기획서". 실행 가이드는 LLM 초안, 숫자(표본 수·결정표·결론 확률)는 코드.
import "server-only";
import { z } from "zod";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must, notFound } from "../api/handler";
import { llmFor } from "../llm/factory";
import { proposalPrompt } from "../llm/prompts";
import { defaultMetricSource, isUsageMethod, methodByKey, methodsFor, type ExperimentMethod } from "../domain/experiments";
import {
  assertThresholds, conclusionProbability, decisionTable, MAX_LOOKS, requiredSampleSize, type Thresholds,
} from "../stats/verdict";
import { designEffect } from "../stats/cluster";
import { canvasText, latestBusinessModel } from "./diagnosis";
import type { HypothesisType } from "../domain/rules";

/** 실사용 지표를 어떤 이벤트로 잴지. 기준과 함께 잠근다 (잠근 뒤에는 바꿀 수 없다). */
export const MetricSource = z.object({
  numerator_event: z.string().trim().min(1).max(200),
  denominator_event: z.string().trim().min(1).max(200),
  window_days: z.number().int().min(1).max(90).default(14),
});
export type MetricSource = z.infer<typeof MetricSource>;

const DAY = 86_400_000;

/** 측정 기간: 기준을 잠근 때(재판정 회차는 그 회차를 만든 때)부터 window_days 동안 */
export function measurementWindow(p: { locked_at: string | null; created_at: string; root_proposal_id?: string | null; metric_source: MetricSource | null }) {
  if (!p.locked_at || !p.metric_source) return null;
  // 재판정 회차는 처음 잠금 시각을 물려받으므로, 그 회차를 만든 때부터 새로 잰다
  const start = new Date(p.root_proposal_id ? Math.max(new Date(p.locked_at).getTime(), new Date(p.created_at).getTime()) : new Date(p.locked_at).getTime());
  const end = new Date(start.getTime() + p.metric_source.window_days * DAY);
  return { start, end };
}

const TABLE_SIZES = [5, 8, 10, 15, 20, 30];
const WEEKS_PER_PROPOSAL = { min: 1, max: 2 };

export interface PlanNumbers {
  sample_size: number | null;
  /** 군집 보정 전 실제로 모아야 할 사람 수 */
  sample_size_raw: number | null;
  conclusion_probability: number | null;
  decision_table: ReturnType<typeof decisionTable>;
  warning: string | null;
}

/** 표본 수: 예상 실제 값에서 결론이 나올 확률이 80% 이상인 가장 작은 n. 묶음이 있으면 설계 효과만큼 늘린다. */
export function planNumbers(t: Thresholds, expected: number, cluster?: { size: number; icc: number } | null): PlanNumbers {
  assertThresholds(t);
  const plan = requiredSampleSize(t, expected);
  const sizes = plan ? [...new Set([...TABLE_SIZES, plan.n])].sort((a, b) => a - b) : TABLE_SIZES;
  const table = decisionTable(sizes, t);
  if (!plan) {
    return {
      sample_size: null,
      sample_size_raw: null,
      conclusion_probability: null,
      decision_table: table,
      warning: "400명 안에서는 결론이 나올 확률이 80%에 이르지 않는다. 목표값과 최소 허용치의 간격을 넓히거나 더 강한 증거 수준의 방법으로 바꾼다.",
    };
  }
  const deff = cluster && cluster.size > 1 ? designEffect(cluster.size, cluster.icc) : 1;
  return {
    sample_size: plan.n,
    sample_size_raw: Math.ceil(plan.n * deff),
    conclusion_probability: plan.probability.pConclusive,
    decision_table: table,
    warning: deff > 1 ? `같은 묶음 안 응답은 독립이 아니어서 실제로는 ${Math.ceil(plan.n * deff)}명이 필요하다 (설계 효과 ${deff.toFixed(2)}).` : null,
  };
}

export async function methodOptions(admin: Db, projectId: string, hypothesisId: string) {
  const h = must(await admin.from("hypotheses").select("type").eq("id", hypothesisId).eq("project_id", projectId).maybeSingle(), "가설");
  const p = must(await admin.from("projects").select("is_b2b").eq("id", projectId).maybeSingle(), "프로젝트");
  return methodsFor(h.type as HypothesisType, p.is_b2b).map((m) => ({
    key: m.key, name: m.name, evidence_level: m.evidenceLevel, measures: m.measures, defaults: m.defaults, cluster_prone: m.clusterProne,
  }));
}

export interface GenerateInput {
  hypothesis_id: string;
  method_key?: string;
  target_value?: number;
  min_value?: number;
  expected_rate?: number;
}

export async function generateProposal(admin: Db, projectId: string, userId: string, input: GenerateInput) {
  const h = must(
    await admin.from("hypotheses").select("*").eq("id", input.hypothesis_id).eq("project_id", projectId).maybeSingle(),
    "가설",
  );
  const project = must(await admin.from("projects").select("is_b2b").eq("id", projectId).maybeSingle(), "프로젝트");
  const options = methodsFor(h.type as HypothesisType, project.is_b2b);
  let method: ExperimentMethod | undefined = input.method_key ? methodByKey(input.method_key) : options[0];
  if (!method) throw badRequest("이 가설 유형에 맞는 실험 방법이 없다. method_key를 지정한다.");
  if (!method.hypothesisTypes.includes(h.type as HypothesisType)) throw badRequest("가설 유형과 맞지 않는 방법이다");

  const t = { target: input.target_value ?? method.defaults.target, min: input.min_value ?? method.defaults.min };
  const expected = input.expected_rate ?? method.defaults.expected;
  const numbers = planNumbers(t, expected);

  let context = "";
  try {
    context = canvasText(await latestBusinessModel(admin, projectId));
  } catch {
    context = "(사업 모델 없음)";
  }
  const llm = llmFor(admin, projectId, userId);
  const draft = await llm.structured(proposalPrompt(h.statement, method, context));

  const proposal = must(
    await admin
      .from("proposals")
      .insert({
        project_id: projectId,
        hypothesis_id: h.id,
        method_key: method.key,
        method: method.name,
        evidence_level_expected: method.evidenceLevel,
        guide_steps: draft.guide_steps,
        prerequisites: [...new Set([...method.prerequisites, ...draft.prerequisites])],
        mvp_scope: draft.mvp_scope,
        recruitment: draft.recruitment,
        script: `${draft.script}\n\n[성공으로 세는 것] ${draft.success_definition}`,
        operating_rules: [...method.operatingRules, ...draft.extra_operating_rules],
        target_value: t.target,
        min_value: t.min,
        expected_rate: expected,
        sample_size: numbers.sample_size,
        decision_table: numbers.decision_table,
        conclusion_probability: numbers.conclusion_probability,
        expected_weeks: method.usage ? Math.ceil(defaultMetricSource(h.type as HypothesisType).window_days / 7) : WEEKS_PER_PROPOSAL.max,
        metric_source: method.usage ? defaultMetricSource(h.type as HypothesisType) : null,
        status: "draft",
        drafted_by_llm: true,
      })
      .select("*")
      .single(),
  );
  return { proposal, numbers, method_options: options.map((m) => m.key) };
}

export interface LockInput {
  target_value: number;
  min_value: number;
  expected_rate: number;
  cluster_size?: number | null;
  icc?: number | null;
}

/** 목표값·최소 허용치를 확정해 잠근다. 이후에는 바꿀 수 없다 (DB 트리거로도 막는다). */
export async function lockProposal(admin: Db, projectId: string, proposalId: string, input: LockInput) {
  const p = must(await admin.from("proposals").select("*").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  if (p.locked_at) throw conflict("이미 잠근 제안이다");
  if (p.root_proposal_id) throw conflict("재판정 제안은 처음 제안의 기준을 그대로 쓴다");
  if (isUsageMethod(p.method_key) && !p.metric_source) throw conflict("실사용 지표는 분자·분모 이벤트를 정한 뒤에 잠근다");
  const t = { target: input.target_value, min: input.min_value };
  const cluster = input.cluster_size && input.cluster_size > 1 ? { size: input.cluster_size, icc: input.icc ?? 0.2 } : null;
  const numbers = planNumbers(t, input.expected_rate, cluster);
  const locked = must(
    await admin
      .from("proposals")
      .update({
        target_value: t.target,
        min_value: t.min,
        expected_rate: input.expected_rate,
        cluster_size: input.cluster_size ?? null,
        icc: input.icc ?? null,
        sample_size: numbers.sample_size_raw,
        decision_table: numbers.decision_table,
        conclusion_probability: numbers.conclusion_probability,
        locked_at: new Date().toISOString(),
        status: "sent",
      })
      .eq("id", proposalId)
      .select("*")
      .single(),
  );
  await admin.from("hypotheses").update({ status: "in_progress" }).eq("id", p.hypothesis_id).in("status", ["unverified", "on_hold", "needs_recheck"]);
  return { proposal: locked, numbers };
}

/** 판정 보류 뒤 표본을 늘린 재판정 제안 (처음 판정 포함 최대 4회, 기준은 물려받는다) */
export async function rejudgeProposal(admin: Db, projectId: string, proposalId: string) {
  const p = must(await admin.from("proposals").select("*").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  const rootId = p.root_proposal_id ?? p.id;
  const chain = must(
    await admin.from("proposals").select("*").or(`id.eq.${rootId},root_proposal_id.eq.${rootId}`).order("look_number"),
  ) as Array<Record<string, unknown> & { id: string; look_number: number }>;
  const last = chain[chain.length - 1]!;
  const { data: verdict } = await admin
    .from("verdicts")
    .select("result, n, proposal_id")
    .eq("root_proposal_id", rootId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!verdict) throw conflict("아직 판정이 없다. 결과를 먼저 제출한다.");
  if (verdict.result !== "on_hold") throw conflict(`판정 보류일 때만 재판정한다 (현재: ${verdict.result})`);
  if (last.look_number >= MAX_LOOKS) throw conflict("재판정 상한(4회)에 이르렀다");
  // 마지막 제안이 아직 결과를 기다리면 새 재판정 제안을 만들지 않는다 (두 번 눌러 회차를 다 쓰지 않게)
  if (verdict.proposal_id !== last.id) {
    throw conflict(`이미 재판정 ${last.look_number}회차 제안이 결과를 기다리고 있다`, { pending_proposal_id: last.id });
  }

  const t = { target: Number(p.target_value), min: Number(p.min_value) };
  const expected = Number((chain[0] as { expected_rate?: number }).expected_rate ?? t.target);
  const current = Number(verdict.n);
  let total: number | null = null;
  for (let n = Math.ceil(current) + 5; n <= 400; n++) {
    if (conclusionProbability(n, t, expected).pConclusive >= 0.8) {
      total = n;
      break;
    }
  }
  const additional = total ? total - Math.ceil(current) : Math.max(10, Math.ceil(current));
  const root = chain[0]!;
  const inserted = await admin
      .from("proposals")
      .insert({
        project_id: projectId,
        hypothesis_id: p.hypothesis_id,
        root_proposal_id: rootId,
        method_key: root.method_key,
        method: `${root.method} (재판정 ${last.look_number + 1}회차: 표본 추가)`,
        evidence_level_expected: root.evidence_level_expected,
        guide_steps: root.guide_steps,
        prerequisites: root.prerequisites,
        mvp_scope: root.mvp_scope,
        recruitment: root.recruitment,
        script: root.script,
        operating_rules: root.operating_rules,
        metric_source: root.metric_source ?? null,
        target_value: t.target,
        min_value: t.min,
        expected_rate: expected,
        sample_size: additional,
        decision_table: decisionTable([Math.ceil(current) + additional], t),
        conclusion_probability: total ? conclusionProbability(total, t, expected).pConclusive : null,
        expected_weeks: WEEKS_PER_PROPOSAL.max,
        status: "sent",
      })
      .select("*")
      .single();
  if (inserted.error?.code === "23505") throw conflict("다른 요청이 같은 회차의 재판정 제안을 먼저 만들었다");
  const child = must(inserted);
  return {
    proposal: child,
    additional_sample: additional,
    cumulative_target: total,
    note: total
      ? `지금까지 ${Math.ceil(current)}명에 ${additional}명을 더하면 결론이 나올 확률이 80% 이상이다.`
      : "400명 안에서는 결론 확률 80%에 이르지 않는다. 이번이 마지막 재판정이 될 수 있으니 방법 변경을 함께 검토한다.",
  };
}

/** 실사용 지표의 분자·분모 이벤트와 측정 기간. 기준을 잠그기 전에만 바꾼다 (DB 트리거로도 막는다). */
export async function setMetricSource(admin: Db, projectId: string, proposalId: string, source: MetricSource) {
  const p = must(await admin.from("proposals").select("id, method_key, locked_at").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  if (!isUsageMethod(p.method_key)) throw badRequest("실사용 지표 기획서에만 측정 이벤트를 정한다");
  if (p.locked_at) throw conflict("기준을 잠근 뒤에는 측정 이벤트를 바꿀 수 없다. 새 기획서를 만든다.");
  return must(
    await admin
      .from("proposals")
      .update({ metric_source: source, expected_weeks: Math.max(0.5, Math.min(8, Math.ceil(source.window_days / 7))) })
      .eq("id", proposalId)
      .select("*")
      .single(),
  );
}

export async function proposalWithContext(admin: Db, projectId: string, proposalId: string) {
  const p = must(await admin.from("proposals").select("*").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  const h = must(await admin.from("hypotheses").select("*").eq("id", p.hypothesis_id).maybeSingle(), "가설");
  const project = must(await admin.from("projects").select("id, name, is_example").eq("id", projectId).maybeSingle(), "프로젝트");
  if (!p) throw notFound("검증 제안");
  return { proposal: p, hypothesis: h, project };
}
