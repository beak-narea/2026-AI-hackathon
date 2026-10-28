// "우리 서비스의 비용 구조": 가격 하한과 손익분기.

/** AI 제품 평균 매출총이익률(2026년 약 52%, ICONIQ 조사)을 출발점으로 둔다 */
export const DEFAULT_TARGET_GROSS_MARGIN = 0.52;
/** 한 번 또는 가끔 드는 비용의 상각 기간 (가정) */
export const AMORTIZATION_MONTHS = 12;

export interface ProgramVariableCost {
  llmCalls: number;
  baselineTests: number;
  externalRaterFees: number;
  storage: number;
}

export function variableCostPerProgram(v: ProgramVariableCost): number {
  return v.llmCalls + v.baselineTests + v.externalRaterFees + v.storage;
}

/** 가격 하한 = 변동비 ÷ (1 − 목표 매출총이익률) */
export function priceFloor(variableCost: number, targetGrossMargin = DEFAULT_TARGET_GROSS_MARGIN): number {
  if (targetGrossMargin < 0 || targetGrossMargin >= 1) throw new RangeError("매출총이익률은 0 이상 1 미만");
  return variableCost / (1 - targetGrossMargin);
}

export interface FixedCosts {
  /** 인력: 기획 1, 개발 2, 디자인 0.5 × 월 인건비 */
  monthlyPeople: number;
  /** 인프라의 고정분 (호스팅·DB) */
  monthlyInfraFixed: number;
  /** 매달 하는 전사본 코딩 표본 점검 */
  monthlyCodingCheck: number;
  /** 법률 검토 (일회성) */
  legalReviewOnce: number;
  /** 코드 유형별 첫 코딩 검증 (일회성 합계) */
  initialCodingValidationOnce: number;
  /** 아첨 점검 1회 비용 × 연간 예상 횟수 */
  sycophancyCheckPerRun: number;
  sycophancyRunsPerYear: number;
}

export function monthlyFixedCost(f: FixedCosts, amortizationMonths = AMORTIZATION_MONTHS): number {
  const amortized =
    (f.legalReviewOnce + f.initialCodingValidationOnce + f.sycophancyCheckPerRun * f.sycophancyRunsPerYear) /
    amortizationMonths;
  return f.monthlyPeople + f.monthlyInfraFixed + f.monthlyCodingCheck + amortized;
}

/** 손익분기 = 월 고정비 ÷ (가격 − 변동비). 가격이 변동비 이하면 null(팔수록 손해). */
export function breakevenProgramsPerMonth(monthlyFixed: number, price: number, variableCost: number): number | null {
  const contribution = price - variableCost;
  if (contribution <= 0) return null;
  return Math.ceil(monthlyFixed / contribution);
}

/** Van Westendorp 수용 범위가 통째로 가격 하한보다 낮은가 */
export function acceptableRangeBelowFloor(range: { low: number; high: number }, floor: number): boolean {
  return range.high < floor;
}
