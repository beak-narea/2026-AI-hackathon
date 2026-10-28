// 기획 문서의 판정·진단 규칙을 코드로 옮긴 것. LLM은 여기 어떤 값도 정하지 않는다.

import { judge, type Verdict, type VerdictResult } from "../stats/verdict";

// ── 열거형 (DB enum, Figma variant 이름과 같다) ─────────────────────────
export const EVIDENCE_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const CRITICALITY = ["critical", "major", "minor"] as const;
export type Criticality = (typeof CRITICALITY)[number];

export const HYPOTHESIS_TYPES = [
  "trust", "accuracy", "data", "demand", "preference", "feasibility", "payment", "other",
] as const;
export type HypothesisType = (typeof HYPOTHESIS_TYPES)[number];

export const ZONES = ["green", "red", "rnd", "low"] as const;
export type Zone = (typeof ZONES)[number];

export const WRAPPER_ITEMS = [
  "proprietary_data", "integration_depth", "human_expertise",
  "switching_cost", "regulatory_barrier", "bigtech_overlap",
] as const;
export type WrapperItemKey = (typeof WRAPPER_ITEMS)[number];
export type TriStatus = "yes" | "no" | "unknown";
export type RiskLevel = "high" | "mid" | "low";

export const DECISION_CHOICES = ["continue", "revise", "stop", "more_validation"] as const;
export type DecisionChoice = (typeof DECISION_CHOICES)[number];
export type ReasonType = "evidence" | "external" | "other";

export const LABEL_KO = {
  verdict: { met: "충족", not_met: "미달", on_hold: "판정 보류", no_conclusion: "결론 없음" },
  criticality: { critical: "치명", major: "중대", minor: "경미" },
  zone: { green: "초록불", red: "빨간불", rnd: "R&D 기회", low: "저우선순위" },
  evidence: { L0: "미확인", L1: "진술", L2: "관심", L3: "노력", L4: "지불" },
  decision: { continue: "계속", revise: "수정", stop: "중단", more_validation: "추가 검증" },
} as const;

const LEVEL_RANK: Record<EvidenceLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
const CRIT_RANK: Record<Criticality, number> = { critical: 0, major: 1, minor: 2 };

export function levelAtLeast(level: EvidenceLevel, min: EvidenceLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

// ── 증거 수준에 따른 판정 가능 여부 ───────────────────────────────────
export interface Judgeability {
  ok: boolean;
  reason?: string;
}

/** L1 이하는 판정하지 않는다. 지불 의향 가설은 L4만 인정한다. */
export function canJudge(type: HypothesisType, level: EvidenceLevel): Judgeability {
  if (type === "payment" && level !== "L4") {
    return { ok: false, reason: "지불 의향 가설은 L4(지불) 증거만 판정에 쓴다" };
  }
  if (!levelAtLeast(level, "L2")) {
    return { ok: false, reason: "L2(관심 행동) 미만 증거는 참고만 하고 판정하지 않는다" };
  }
  return { ok: true };
}

// ── 가설 검증 순서: 중요도 → 증거가 약한 것 순. 두 척도 모두 순서 척도라 곱하지 않는다 ──
export function compareHypotheses(
  a: { criticality: Criticality | null; evidenceLevel: EvidenceLevel },
  b: { criticality: Criticality | null; evidenceLevel: EvidenceLevel },
): number {
  const ca = a.criticality ? CRIT_RANK[a.criticality] : 3;
  const cb = b.criticality ? CRIT_RANK[b.criticality] : 3;
  if (ca !== cb) return ca - cb;
  return LEVEL_RANK[a.evidenceLevel] - LEVEL_RANK[b.evidenceLevel];
}

// ── 중요도 평정 ───────────────────────────────────────────────────────
export interface Rating {
  raterType: "team" | "external" | "llm";
  level: Criticality;
}

export interface CriticalityConsensus {
  /** 사람 평정이 모두 같을 때의 값. 다르면 null → 토론 후 팀이 확정 */
  consensus: Criticality | null;
  needsDiscussion: boolean;
  /** "치명" 후보인데 팀 밖 평가자가 아직 없다 */
  needsExternalRater: boolean;
  /** LLM 반대 평가자와 사람 평정이 2단계(치명 ↔ 경미) 차이 */
  llmFlagReview: boolean;
  humanRaterCount: number;
}

export function criticalityConsensus(ratings: Rating[]): CriticalityConsensus {
  const humans = ratings.filter((r) => r.raterType !== "llm");
  const llm = ratings.find((r) => r.raterType === "llm");
  const levels = new Set(humans.map((r) => r.level));
  const consensus = humans.length >= 2 && levels.size === 1 ? humans[0]!.level : null;
  const anyCritical = humans.some((r) => r.level === "critical");
  const hasExternal = humans.some((r) => r.raterType === "external");
  const llmFlagReview =
    !!llm && humans.some((h) => Math.abs(CRIT_RANK[h.level] - CRIT_RANK[llm.level]) === 2);
  return {
    consensus,
    needsDiscussion: humans.length >= 2 && levels.size > 1,
    needsExternalRater: anyCritical && !hasExternal,
    llmFlagReview,
    humanRaterCount: humans.length,
  };
}

// ── 대체 위험 등급 (3번 기능) ─────────────────────────────────────────
export function wrapperRisk(
  items: Partial<Record<WrapperItemKey, TriStatus>>,
  baseline: VerdictResult | null,
): RiskLevel {
  const no = (k: WrapperItemKey) => items[k] === "no";
  if (baseline === "not_met" || (no("proprietary_data") && no("integration_depth"))) return "high";
  const weak = (["proprietary_data", "integration_depth", "switching_cost"] as const).filter(no).length;
  if (weak >= 2) return "mid";
  return "low";
}

// ── 블라인드 기준선 테스트: 샘플당 다수결 1표, 동수면 범용 모델 쪽 ─────────
export const BASELINE_THRESHOLDS = { target: 0.7, min: 0.5 } as const;
export const BASELINE_MIN_SAMPLES = 10;

export interface BaselineVote {
  sampleIndex: number;
  /** 평가자가 자사 결과를 골랐는가 */
  choseOurs: boolean;
}

export function baselineVerdict(votes: BaselineVote[], look = 1): Verdict & { samples: number; oursWins: number } {
  const bySample = new Map<number, { ours: number; generic: number }>();
  for (const v of votes) {
    const s = bySample.get(v.sampleIndex) ?? { ours: 0, generic: 0 };
    if (v.choseOurs) s.ours++;
    else s.generic++;
    bySample.set(v.sampleIndex, s);
  }
  let oursWins = 0;
  for (const s of bySample.values()) if (s.ours > s.generic) oursWins++;
  const samples = bySample.size;
  return { ...judge({ successes: oursWins, n: samples, ...BASELINE_THRESHOLDS, look }), samples, oursWins };
}

// ── 자동화 수요 4구역 (1번 기능) ──────────────────────────────────────
export interface AxisState {
  verdict: VerdictResult | null;
  level: EvidenceLevel;
}

export interface ZoneResult {
  zone: Zone | null;
  provisional: boolean;
}

/** 가능성 축·수요 축이 각각 충족(높음)/미달(낮음)일 때 구역. 하나라도 보류·미확인이면 구역 없음. */
export function automationZone(feasibility: AxisState, demand: AxisState): ZoneResult {
  const high = (a: AxisState) => (a.verdict === "met" ? true : a.verdict === "not_met" ? false : null);
  const f = high(feasibility);
  const d = high(demand);
  const provisional = !levelAtLeast(feasibility.level, "L2") || !levelAtLeast(demand.level, "L2");
  if (f === null || d === null) return { zone: null, provisional: true };
  const zone: Zone = f && d ? "green" : f && !d ? "red" : !f && d ? "rnd" : "low";
  return { zone, provisional };
}

/** 진단 결과로 "치명" 후보 표시 (팀원이 매길 때 참고만 한다) */
export function isCriticalCandidate(signal: { zone?: Zone | null; wrapperRisk?: RiskLevel | null; margin?: number | null }): boolean {
  return signal.zone === "red" || signal.wrapperRisk === "high" || (signal.margin ?? 0) < 0;
}

// ── 인터뷰 진행 품질 ──────────────────────────────────────────────────
export type QuestionKind = "leading" | "future" | "past" | "other";

export function interviewQuality(kinds: QuestionKind[]): {
  leadingRatio: number; futureRatio: number; pastRatio: number; lowTrust: boolean;
} {
  const total = kinds.length || 1;
  const count = (k: QuestionKind) => kinds.filter((x) => x === k).length;
  const leadingRatio = count("leading") / total;
  const futureRatio = count("future") / total;
  const pastRatio = count("past") / total;
  return { leadingRatio, futureRatio, pastRatio, lowTrust: leadingRatio + futureRatio > 0.5 };
}

// ── 서비스 성공 기준: 근거 있는 수정·중단 ─────────────────────────────
export interface DecisionForSuccess {
  choice: DecisionChoice;
  reasonType: ReasonType;
  verdictResult: VerdictResult | null;
  verdictEvidenceLevel: EvidenceLevel | null;
  linkedToHypothesisAndEvidence: boolean;
}

export function isGroundedChange(d: DecisionForSuccess): boolean {
  if (d.choice !== "revise" && d.choice !== "stop") return false;
  if (d.reasonType !== "evidence") return false;
  if (!d.linkedToHypothesisAndEvidence) return false;
  if (!d.verdictEvidenceLevel || !levelAtLeast(d.verdictEvidenceLevel, "L2")) return false;
  if (d.choice === "stop") return d.verdictResult === "not_met";
  return d.verdictResult === "met" || d.verdictResult === "not_met";
}

/** 결정에 따른 가설 상태. 가설 상태는 의사결정을 거쳐서만 바뀐다. */
export function hypothesisStatusAfterDecision(
  verdict: VerdictResult,
  choice: DecisionChoice,
): "met" | "not_met" | "on_hold" | "in_progress" {
  if (choice === "more_validation") return "in_progress";
  if (verdict === "met") return "met";
  if (verdict === "not_met") return "not_met";
  return "on_hold";
}

/** 서비스 권고 (최종 결정은 고객 팀). 치명 가설의 미달은 확인 실험 1회를 먼저 권고한다. */
export function recommend(
  verdict: VerdictResult,
  criticality: Criticality | null,
  confirmationDone: boolean,
): { recommendation: DecisionChoice; rationale: string } {
  switch (verdict) {
    case "met":
      return { recommendation: "continue", rationale: "목표값을 넘을 확률이 판정 기준(80%) 이상이다." };
    case "not_met":
      if (criticality === "critical" && !confirmationDone) {
        return {
          recommendation: "more_validation",
          rationale: "치명 가설의 미달이다. 틀렸을 때 대가가 크므로 중단 전에 다른 방법으로 확인 실험 1회를 권고한다.",
        };
      }
      return {
        recommendation: criticality === "critical" ? "stop" : "revise",
        rationale: "최소 허용치에 못 미칠 확률이 판정 기준(80%) 이상이다.",
      };
    case "on_hold":
      return { recommendation: "more_validation", rationale: "충족도 미달도 아니다. 표본을 늘린 검증 제안을 보낸다." };
    case "no_conclusion":
      return {
        recommendation: "revise",
        rationale: "재판정 상한(4회)까지 결론이 나지 않았다. 목표값·최소 허용치 간격을 넓히거나 더 강한 증거 수준의 방법으로 새 검증 제안을 만든다.",
      };
  }
}
