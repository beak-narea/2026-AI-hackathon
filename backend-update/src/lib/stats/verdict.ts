// 3갈래 판정 규칙 (기획 문서 "판정 체계")
// Jeffreys 사전분포 Beta(0.5, 0.5) → 사후 Beta(k + 0.5, n − k + 0.5)
// P(p > 목표값) ≥ 0.8 → 충족, P(p < 최소 허용치) ≥ 0.8 → 미달, 나머지 → 판정 보류
// 같은 검증 제안의 재판정은 처음 판정을 포함해 최대 4회. 4회째에도 보류면 "결론 없음".

import { betaCdf, binomPmf } from "./beta";

export type VerdictResult = "met" | "not_met" | "on_hold" | "no_conclusion";

export const DECISION_THRESHOLD = 0.8;
export const MAX_LOOKS = 4;
export const JEFFREYS = 0.5;

export interface Thresholds {
  /** 목표값(TV): 사업 계획이 성립하는 비율 */
  target: number;
  /** 최소 허용치(MAV): 이보다 낮으면 사업 모델을 바꿔야 하는 비율 */
  min: number;
}

export function assertThresholds({ target, min }: Thresholds): void {
  if (!(min > 0 && min < 1 && target > 0 && target < 1)) {
    throw new RangeError("목표값과 최소 허용치는 0과 1 사이여야 한다");
  }
  if (!(target > min)) throw new RangeError("목표값은 최소 허용치보다 커야 한다");
}

export interface VerdictInput extends Thresholds {
  successes: number;
  /** 유효 표본 수 (군집 보정 후 소수일 수 있다) */
  n: number;
  /** 이 검증 제안 사슬에서 몇 번째 판정인가 (1부터) */
  look?: number;
  threshold?: number;
  maxLooks?: number;
}

export interface Verdict {
  result: VerdictResult;
  pAboveTarget: number;
  pBelowMin: number;
  posteriorMean: number;
  wilsonLow: number;
  wilsonHigh: number;
  n: number;
  successes: number;
  look: number;
  /** 다음 판정이 가능한가 (보류이고 상한 전) */
  canRejudge: boolean;
}

export function judge(input: VerdictInput): Verdict {
  assertThresholds(input);
  const threshold = input.threshold ?? DECISION_THRESHOLD;
  const maxLooks = input.maxLooks ?? MAX_LOOKS;
  const look = input.look ?? 1;
  const { successes: k, n } = input;
  if (n < 0 || k < 0 || k > n) throw new RangeError("0 ≤ 성공 수 ≤ 표본 수여야 한다");
  if (look < 1 || look > maxLooks) throw new RangeError(`재판정은 최대 ${maxLooks}회다`);

  const a = k + JEFFREYS;
  const b = n - k + JEFFREYS;
  const pAboveTarget = 1 - betaCdf(input.target, a, b);
  const pBelowMin = betaCdf(input.min, a, b);
  const [wilsonLow, wilsonHigh] = wilson(k, n);

  let result: VerdictResult;
  if (n > 0 && pAboveTarget >= threshold) result = "met";
  else if (n > 0 && pBelowMin >= threshold) result = "not_met";
  else result = look >= maxLooks ? "no_conclusion" : "on_hold";

  return {
    result,
    pAboveTarget,
    pBelowMin,
    posteriorMean: a / (a + b),
    wilsonLow,
    wilsonHigh,
    n,
    successes: k,
    look,
    canRejudge: result === "on_hold",
  };
}

/** Wilson 점수 구간 (작은 표본 보고용). n = 0이면 [0, 1]. */
export function wilson(k: number, n: number, z = 1.959963984540054): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export interface DecisionBounds {
  n: number;
  /** 이 수 이상이면 충족 (없으면 null: 이 표본으로는 충족 불가) */
  metFrom: number | null;
  /** 이 수 이하이면 미달 (없으면 null) */
  failTo: number | null;
}

/** 정수 표본 n에서 충족·미달이 되는 성공 수의 경계 */
export function decisionBounds(n: number, t: Thresholds, threshold = DECISION_THRESHOLD): DecisionBounds {
  assertThresholds(t);
  let metFrom: number | null = null;
  let failTo: number | null = null;
  for (let k = 0; k <= n; k++) {
    const a = k + JEFFREYS;
    const b = n - k + JEFFREYS;
    if (metFrom === null && 1 - betaCdf(t.target, a, b) >= threshold) metFrom = k;
    if (betaCdf(t.min, a, b) >= threshold) failTo = k;
  }
  return { n, metFrom, failTo };
}

export interface DecisionTableRow extends DecisionBounds {
  holdFrom: number | null;
  holdTo: number | null;
}

/** 기획서에 넣는 작은 표본 결정표 */
export function decisionTable(ns: number[], t: Thresholds, threshold = DECISION_THRESHOLD): DecisionTableRow[] {
  return ns.map((n) => {
    const bounds = decisionBounds(n, t, threshold);
    const holdFrom = bounds.failTo === null ? 0 : bounds.failTo + 1;
    const holdTo = bounds.metFrom === null ? n : bounds.metFrom - 1;
    return {
      ...bounds,
      holdFrom: holdFrom <= holdTo ? holdFrom : null,
      holdTo: holdFrom <= holdTo ? holdTo : null,
    };
  });
}

export interface ConclusionProbability {
  pMet: number;
  pNotMet: number;
  pHold: number;
  /** 충족 또는 미달이 나올 확률 */
  pConclusive: number;
}

/** 실제 비율이 p일 때 n명으로 각 판정이 나올 확률 (이항분포로 정확히 계산) */
export function conclusionProbability(
  n: number,
  t: Thresholds,
  p: number,
  threshold = DECISION_THRESHOLD,
): ConclusionProbability {
  const { metFrom, failTo } = decisionBounds(n, t, threshold);
  let pMet = 0;
  let pNotMet = 0;
  for (let k = 0; k <= n; k++) {
    const pk = binomPmf(k, n, p);
    if (metFrom !== null && k >= metFrom) pMet += pk;
    else if (failTo !== null && k <= failTo) pNotMet += pk;
  }
  const pConclusive = pMet + pNotMet;
  return { pMet, pNotMet, pHold: Math.max(0, 1 - pConclusive), pConclusive };
}

export interface SampleSizePlan {
  n: number;
  probability: ConclusionProbability;
}

/**
 * 예상 실제 값에서 결론이 나올 확률이 power(기본 80%, Cohen 관례) 이상인 가장 작은 표본.
 * 이항분포는 표본 수에 따라 톱니 모양으로 오르내리므로, 찾은 n 다음 몇 개도 함께 확인한다.
 * maxN 안에서 못 찾으면 null → 목표값·최소 허용치 간격을 넓히거나 더 강한 방법으로 바꾸라는 신호.
 */
export function requiredSampleSize(
  t: Thresholds,
  expected: number,
  opts: { power?: number; minN?: number; maxN?: number; stableWindow?: number } = {},
): SampleSizePlan | null {
  const power = opts.power ?? 0.8;
  const minN = opts.minN ?? 5;
  const maxN = opts.maxN ?? 400;
  const window = opts.stableWindow ?? 0;
  for (let n = minN; n <= maxN; n++) {
    const probability = conclusionProbability(n, t, expected);
    if (probability.pConclusive < power) continue;
    let stable = true;
    for (let j = 1; j <= window && n + j <= maxN; j++) {
      if (conclusionProbability(n + j, t, expected).pConclusive < power) {
        stable = false;
        break;
      }
    }
    if (stable) return { n, probability };
  }
  return null;
}

/** 0건 규칙: n명 중 0명일 때 실제 비율의 95% 상한. 3의 법칙과 정확한 값. */
export function zeroEventUpperBound(n: number, alpha = 0.05): { ruleOfThree: number; exact: number } {
  if (n <= 0) return { ruleOfThree: 1, exact: 1 };
  return { ruleOfThree: Math.min(1, 3 / n), exact: 1 - Math.pow(alpha, 1 / n) };
}
