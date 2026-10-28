// 4번 기능: AI 운영비 유닛 이코노믹스. 계산은 전부 코드로 한다.

import { z } from "zod";

export const CostInputsSchema = z.object({
  /** N: 사용자당 월 작업 수 */
  tasksPerUser: z.number().nonnegative(),
  /** k: 작업당 모델 호출 수 */
  callsPerTask: z.number().nonnegative(),
  /** 호출당 입력 토큰 */
  inputTokens: z.number().nonnegative(),
  /** 호출당 출력 토큰 */
  outputTokens: z.number().nonnegative(),
  /** 입력 100만 토큰당 가격 (원) */
  inputPricePerMTok: z.number().nonnegative(),
  /** 출력 100만 토큰당 가격 (원) */
  outputPricePerMTok: z.number().nonnegative(),
  /** s: 캐시로 줄어드는 입력 비용 비율 (0~1) */
  cacheSaving: z.number().min(0).max(1).default(0),
  /** r: 재시도율 (0.1 = 호출의 10%가 한 번 더 나간다) */
  retryRate: z.number().min(0).default(0),
  /** h: 작업당 사람 검수 시간 (시간) */
  reviewHoursPerTask: z.number().nonnegative().default(0),
  /** w: 검수 시급 (원) */
  hourlyWage: z.number().nonnegative().default(0),
  /** P: 사용자당 월 가격 (원) */
  monthlyPrice: z.number().nonnegative(),
});
export type CostInputs = z.infer<typeof CostInputsSchema>;

export const USAGE_SCENARIOS = {
  /** 상위 10%가 전체 사용량의 10% */
  uniform: { label: "균등", topShare: 0.1 },
  /** 상위 10%가 64% (Cursor가 공개한 개발자 도구 사례 하나. 다른 AI 제품에도 맞는다는 근거는 없다) */
  observed: { label: "관측 사례", topShare: 0.64 },
  /** 상위 10%가 80% */
  extreme: { label: "극단", topShare: 0.8 },
} as const;
export type ScenarioKey = keyof typeof USAGE_SCENARIOS;

export const SENSITIVITY_CASES = {
  price_10x_down: { label: "모델 단가 연 10배 하락", priceFactor: 0.1, outputFactor: 1 },
  price_half: { label: "모델 단가 50% 하락", priceFactor: 0.5, outputFactor: 1 },
  price_double: { label: "모델 단가 2배 상승", priceFactor: 2, outputFactor: 1 },
  output_double: { label: "출력 토큰 2배", priceFactor: 1, outputFactor: 2 },
} as const;
export type SensitivityKey = keyof typeof SENSITIVITY_CASES;

export interface TaskCost {
  model: number;
  review: number;
  total: number;
}

export function costPerTask(i: CostInputs, priceFactor = 1, outputFactor = 1): TaskCost {
  const calls = i.callsPerTask * (1 + i.retryRate);
  const inputCost = (i.inputTokens * (1 - i.cacheSaving) * i.inputPricePerMTok * priceFactor) / 1e6;
  const outputCost = (i.outputTokens * outputFactor * i.outputPricePerMTok * priceFactor) / 1e6;
  const model = calls * (inputCost + outputCost);
  const review = i.reviewHoursPerTask * i.hourlyWage;
  return { model, review, total: model + review };
}

export interface ScenarioResult {
  scenario: ScenarioKey;
  label: string;
  topShare: number;
  /** 상위 10% 사용자의 1인당 사용량 배수 (평균 = 1) */
  heavyMultiplier: number;
  lightMultiplier: number;
  /** 사용자당 평균 월 비용과 마진 (시나리오와 무관하게 같다) */
  avgCost: number;
  avgMargin: number;
  avgMarginRate: number | null;
  /** 상위 10% 사용자 1인의 월 마진 */
  heavyMargin: number;
  lightMargin: number;
  /** 헤비 유저가 손해를 내는가 */
  heavyLoses: boolean;
}

export function scenarioResults(i: CostInputs): ScenarioResult[] {
  const cpt = costPerTask(i).total;
  const avgCost = i.tasksPerUser * cpt;
  return (Object.keys(USAGE_SCENARIOS) as ScenarioKey[]).map((key) => {
    const { label, topShare } = USAGE_SCENARIOS[key];
    const heavyMultiplier = topShare / 0.1;
    const lightMultiplier = (1 - topShare) / 0.9;
    const heavyMargin = i.monthlyPrice - avgCost * heavyMultiplier;
    return {
      scenario: key,
      label,
      topShare,
      heavyMultiplier,
      lightMultiplier,
      avgCost,
      avgMargin: i.monthlyPrice - avgCost,
      avgMarginRate: i.monthlyPrice > 0 ? (i.monthlyPrice - avgCost) / i.monthlyPrice : null,
      heavyMargin,
      lightMargin: i.monthlyPrice - avgCost * lightMultiplier,
      heavyLoses: heavyMargin < 0,
    };
  });
}

export interface SensitivityResult {
  case: SensitivityKey;
  label: string;
  /** 평균 사용자 기준 손익분기 월 가격 */
  breakevenPrice: number;
  /** 관측 사례(상위 10% = 64%)의 헤비 유저 기준 손익분기 월 가격 */
  heavyBreakevenPrice: number;
}

export function sensitivity(i: CostInputs): SensitivityResult[] {
  const heavy = USAGE_SCENARIOS.observed.topShare / 0.1;
  return (Object.keys(SENSITIVITY_CASES) as SensitivityKey[]).map((key) => {
    const c = SENSITIVITY_CASES[key];
    const avg = i.tasksPerUser * costPerTask(i, c.priceFactor, c.outputFactor).total;
    return { case: key, label: c.label, breakevenPrice: avg, heavyBreakevenPrice: avg * heavy };
  });
}

export interface CostModelResult {
  costPerTask: TaskCost;
  scenarios: ScenarioResult[];
  sensitivity: SensitivityResult[];
  /** 평균 마진 (진단의 "마진 음수" 신호에 쓴다) */
  margin: number;
}

export function computeCostModel(raw: unknown): CostModelResult {
  const i = CostInputsSchema.parse(raw);
  const scenarios = scenarioResults(i);
  return {
    costPerTask: costPerTask(i),
    scenarios,
    sensitivity: sensitivity(i),
    margin: scenarios[0]!.avgMargin,
  };
}
