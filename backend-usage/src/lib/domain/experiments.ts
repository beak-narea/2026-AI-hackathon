// 실험 목록: 기획 문서 "증거 수준 척도와 제품 없이 하는 행동 실험"의 두 표.
// 네 조건(제품 없이 가능, L2 이상, AI 특화 가설에 맞음, 개발 없이 실행 가이드만으로 가능)을 만족하는 방법만 둔다.
// 목표값·최소 허용치 기본값은 초안이다. 고객 팀이 확정해 제안 시점에 잠근다.

import type { EvidenceLevel, HypothesisType } from "./rules";

export interface ExperimentMethod {
  key: string;
  name: string;
  hypothesisTypes: HypothesisType[];
  /** traffic = 트래픽이 있는 팀, b2b = 트래픽 없이 영업 대화로 */
  channel: "traffic" | "b2b" | "any";
  evidenceLevel: EvidenceLevel;
  measures: string;
  /** 성공으로 세는 것 (결과 제출 폼의 successes) */
  successDefinition: string;
  defaults: { target: number; min: number; expected: number };
  operatingRules: string[];
  prerequisites: string[];
  /** 같은 사람·회사에서 여러 관측이 나오기 쉬운가 (군집 보정 안내) */
  clusterProne: boolean;
  /** 출시한 제품의 실사용 데이터로 재는 방법: 결과는 연결한 분석 도구(또는 직접 집계)의 이벤트 수로 받는다 */
  usage?: boolean;
}

const HONEST_FAKE_DOOR = [
  "버튼을 누른 직후 '준비 중'임을 사실대로 알린다",
  "결제·해지 같은 핵심 경로에는 가짜 버튼을 두지 않는다",
  "같은 화면에 이미 잘 쓰이는 기능 버튼을 함께 두고 그 클릭률을 기준점으로 삼는다",
];
const WIZARD_RULES = [
  "끝난 뒤 사람이 만든 결과였음을 반드시 알린다",
  "같은 입력에는 같은 품질로 답한다 (답변 규칙을 미리 문서로 정한다)",
];

export const EXPERIMENTS: ExperimentMethod[] = [
  {
    key: "fake_door", name: "가짜 버튼", hypothesisTypes: ["demand"], channel: "traffic", evidenceLevel: "L2",
    measures: "노출 대비 클릭률", successDefinition: "AI 기능 버튼을 누른 방문자 수",
    defaults: { target: 0.1, min: 0.03, expected: 0.12 }, operatingRules: HONEST_FAKE_DOOR, prerequisites: ["기존 서비스나 랜딩 페이지"],
    clusterProne: false,
  },
  {
    key: "fake_door_pair", name: "가짜 버튼 2종 (자동 처리 / AI 초안 후 직접 검토)", hypothesisTypes: ["preference"], channel: "traffic",
    evidenceLevel: "L2", measures: "두 버튼의 선택 비율", successDefinition: "'AI 초안 후 직접 검토'를 고른 수 (가설 방향에 맞춰 정한다)",
    defaults: { target: 0.6, min: 0.4, expected: 0.65 }, operatingRules: HONEST_FAKE_DOOR, prerequisites: ["기존 서비스나 랜딩 페이지"],
    clusterProne: false,
  },
  {
    key: "data_sample_baseline", name: "데이터 샘플 기준선 측정", hypothesisTypes: ["feasibility"], channel: "any", evidenceLevel: "L3",
    measures: "요구 정확도 대비 달성률", successDefinition: "범용 모델이 정답과 일치한 샘플 수",
    defaults: { target: 0.9, min: 0.75, expected: 0.85 }, operatingRules: [],
    prerequisites: ["고객이 준 실제 데이터 샘플", "샘플마다 사람이 만든 정답"], clusterProne: false,
  },
  {
    key: "concierge_accuracy", name: "컨시어지 (정확도 수준을 달리한 수작업 결과)", hypothesisTypes: ["accuracy"], channel: "any",
    evidenceLevel: "L3", measures: "수준별 실제 채택률", successDefinition: "결과물을 실제 업무에 채택한 수",
    defaults: { target: 0.6, min: 0.4, expected: 0.7 }, operatingRules: ["고객도 수작업임을 미리 안다"],
    prerequisites: ["사람이 만든 정답이 달린 샘플"], clusterProne: true,
  },
  {
    key: "wizard_of_oz", name: "오즈의 마법사", hypothesisTypes: ["trust"], channel: "any", evidenceLevel: "L3",
    measures: "고치지 않고 쓴 비율", successDefinition: "결과물을 고치지 않고 그대로 쓴 건수",
    defaults: { target: 0.6, min: 0.4, expected: 0.65 }, operatingRules: WIZARD_RULES, prerequisites: ["답변 규칙 문서"],
    clusterProne: true,
  },
  {
    key: "data_sample_request", name: "데이터 샘플 요청", hypothesisTypes: ["data"], channel: "any", evidenceLevel: "L3",
    measures: "받은 샘플 수와 품질", successDefinition: "요청한 기준을 채운 샘플을 보낸 고객 수",
    defaults: { target: 0.5, min: 0.25, expected: 0.5 }, operatingRules: ["의향서는 증거로 세지 않는다"], prerequisites: [],
    clusterProne: false,
  },
  {
    key: "landing_deposit", name: "랜딩 페이지 + 환불 가능 예약금", hypothesisTypes: ["payment"], channel: "traffic", evidenceLevel: "L4",
    measures: "결제 전환", successDefinition: "예약금을 결제한 수", defaults: { target: 0.05, min: 0.01, expected: 0.06 },
    operatingRules: ["전액 환불 조건과 방법을 결제 전에 알린다"], prerequisites: ["결제 링크"], clusterProne: false,
  },
  {
    key: "b2b_followup_meeting", name: "문제 중심 연락 후 목적이 정해진 후속 미팅 요청", hypothesisTypes: ["demand"], channel: "b2b",
    evidenceLevel: "L2", measures: "후속 미팅 수락률", successDefinition: "목적이 정해진 후속 미팅을 수락한 회사 수",
    defaults: { target: 0.4, min: 0.2, expected: 0.45 }, operatingRules: ["지인 소개 비율을 기록한다"], prerequisites: ["목표 고객 명단"],
    clusterProne: true,
  },
  {
    key: "b2b_mode_choice", name: "데모 미팅에서 두 방식을 같은 가격으로 제시", hypothesisTypes: ["preference"], channel: "b2b",
    evidenceLevel: "L2", measures: "실제로 고른 방식", successDefinition: "가설이 예측한 방식을 고른 회사 수",
    defaults: { target: 0.6, min: 0.4, expected: 0.65 }, operatingRules: [], prerequisites: ["두 방식의 화면 시안"], clusterProne: true,
  },
  {
    key: "paid_poc", name: "유료 PoC (기술 질문에 한해)", hypothesisTypes: ["feasibility"], channel: "b2b", evidenceLevel: "L3",
    measures: "서면 합격 기준 통과 여부", successDefinition: "합격 기준을 통과한 PoC 수",
    defaults: { target: 0.7, min: 0.5, expected: 0.75 }, operatingRules: ["PoC는 제품 수요·지불 의향의 증거로 쓰지 않는다"],
    prerequisites: ["서면 합격 기준", "고객 데이터"], clusterProne: false,
  },
  {
    key: "design_partner_usage", name: "공동 개발 고객 (실제 업무 흐름에서 사용)", hypothesisTypes: ["trust", "accuracy"], channel: "b2b",
    evidenceLevel: "L3", measures: "고치지 않고 쓴 비율, 수준별 채택률", successDefinition: "결과물을 고치지 않고 쓴 건수",
    defaults: { target: 0.6, min: 0.4, expected: 0.65 }, operatingRules: [], prerequisites: [], clusterProne: true,
  },
  {
    key: "paid_pilot", name: "유료 파일럿", hypothesisTypes: ["payment"], channel: "b2b", evidenceLevel: "L4",
    measures: "유료 파일럿 체결 수", successDefinition: "선결제한 회사 수", defaults: { target: 0.25, min: 0.1, expected: 0.3 },
    operatingRules: ["예산 권한자 서명, 환불 불가 비용, 사전 합의 성공 지표와 결정일을 갖춘다"], prerequisites: ["파일럿 계약서"],
    clusterProne: false,
  },
  // 출시한 뒤에도 같은 틀로 잰다: 기준을 먼저 잠그고, 측정 기간이 끝나면 분석 도구의 값으로 한 번 판정한다
  {
    key: "usage_metric", name: "실사용 지표", hypothesisTypes: ["demand", "preference", "trust", "accuracy"], channel: "any",
    evidenceLevel: "L3", measures: "측정 기간에 기회를 가진 사람 중 행동한 사람의 비율", successDefinition: "분자 이벤트를 남긴 사람 수",
    defaults: { target: 0.4, min: 0.2, expected: 0.45 }, operatingRules: [], prerequisites: ["출시한 제품이나 기능", "분석 도구 연결 또는 직접 집계"],
    clusterProne: false, usage: true,
  },
  {
    key: "usage_payment", name: "실사용 결제 전환", hypothesisTypes: ["payment"], channel: "any", evidenceLevel: "L4",
    measures: "측정 기간에 결제 화면을 본 사람 중 결제한 사람의 비율", successDefinition: "결제한 사람 수",
    defaults: { target: 0.05, min: 0.01, expected: 0.06 }, operatingRules: [], prerequisites: ["출시한 제품의 결제 화면", "분석 도구 연결 또는 직접 집계"],
    clusterProne: false, usage: true,
  },
];

export const USAGE_METHOD_KEYS = ["usage_metric", "usage_payment"] as const;
export const isUsageMethod = (key: string | null | undefined): boolean => !!key && (USAGE_METHOD_KEYS as readonly string[]).includes(key);

/** 실사용 지표의 분자·분모 이벤트 초안 (팀이 기준을 잠그기 전에 고친다) */
export function defaultMetricSource(type: HypothesisType): { numerator_event: string; denominator_event: string; window_days: number } {
  const pairs: Partial<Record<HypothesisType, [string, string]>> = {
    demand: ["ai_feature_used", "ai_feature_viewed"],
    preference: ["ai_mode_selected", "ai_mode_offered"],
    trust: ["ai_output_accepted_unedited", "ai_output_shown"],
    accuracy: ["ai_output_adopted", "ai_output_shown"],
    payment: ["subscription_paid", "paywall_viewed"],
  };
  const [numerator_event, denominator_event] = pairs[type] ?? ["validated_behavior", "opportunity_seen"];
  return { numerator_event, denominator_event, window_days: 14 };
}

/** 유료 파일럿이 데모가 아니라 파일럿인지 보는 조건 (결과 제출 폼에 함께 적는다) */
export const PILOT_CONDITIONS = [
  "budget_owner_signed", "non_refundable_fee", "real_users_and_data", "agreed_baseline_and_metric",
  "known_list_price", "named_decider", "decision_date",
] as const;

export function methodsFor(type: HypothesisType, isB2b: boolean): ExperimentMethod[] {
  const channel = isB2b ? "b2b" : "traffic";
  return EXPERIMENTS.filter((m) => m.hypothesisTypes.includes(type) && (m.channel === channel || m.channel === "any"));
}

export function methodByKey(key: string): ExperimentMethod | undefined {
  return EXPERIMENTS.find((m) => m.key === key);
}
