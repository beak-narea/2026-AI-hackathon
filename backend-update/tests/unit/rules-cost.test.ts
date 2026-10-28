import { describe, expect, it } from "vitest";
import {
  automationZone, baselineVerdict, canJudge, compareHypotheses, criticalityConsensus, interviewQuality,
  isGroundedChange, recommend, wrapperRisk,
} from "@/lib/domain/rules";
import { computeCostModel } from "@/lib/cost/unitEconomics";
import { breakevenProgramsPerMonth, monthlyFixedCost, priceFloor } from "@/lib/cost/ourService";
import { vanWestendorp } from "@/lib/cost/vanWestendorp";

describe("증거 수준 판정 가능 여부", () => {
  it("L1은 판정하지 않고, 지불은 L4만", () => {
    expect(canJudge("demand", "L1").ok).toBe(false);
    expect(canJudge("demand", "L2").ok).toBe(true);
    expect(canJudge("payment", "L3").ok).toBe(false);
    expect(canJudge("payment", "L4").ok).toBe(true);
  });
});

describe("가설 순서", () => {
  it("중요도 먼저, 같은 중요도에서는 증거가 약한 것 먼저", () => {
    const list = [
      { id: "a", criticality: "major" as const, evidenceLevel: "L0" as const },
      { id: "b", criticality: "critical" as const, evidenceLevel: "L3" as const },
      { id: "c", criticality: "critical" as const, evidenceLevel: "L1" as const },
    ];
    expect(list.sort(compareHypotheses).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("중요도 평정", () => {
  it("치명 후보는 외부 평가자가 필요하고, LLM 2단계 차이는 재검토", () => {
    const r = criticalityConsensus([
      { raterType: "team", level: "critical" },
      { raterType: "team", level: "critical" },
      { raterType: "llm", level: "minor" },
    ]);
    expect(r.consensus).toBe("critical");
    expect(r.needsExternalRater).toBe(true);
    expect(r.llmFlagReview).toBe(true);
  });
  it("사람끼리 다르면 토론", () => {
    const r = criticalityConsensus([
      { raterType: "team", level: "major" },
      { raterType: "external", level: "minor" },
    ]);
    expect(r).toMatchObject({ consensus: null, needsDiscussion: true });
  });
});

describe("대체 위험", () => {
  it("기준선 미달이면 높음", () => expect(wrapperRisk({}, "not_met")).toBe("high"));
  it("독점 데이터·연동 깊이 둘 다 없음이면 높음", () =>
    expect(wrapperRisk({ proprietary_data: "no", integration_depth: "no" }, "met")).toBe("high"));
  it("셋 중 2개 없음이면 중간", () =>
    expect(wrapperRisk({ proprietary_data: "no", switching_cost: "no" }, "met")).toBe("mid"));
  it("나머지는 낮음", () => expect(wrapperRisk({ proprietary_data: "yes" }, "met")).toBe("low"));
});

describe("기준선 테스트", () => {
  it("샘플당 다수결, 동수는 범용 모델 쪽", () => {
    const votes = Array.from({ length: 10 }, (_, i) => [
      { sampleIndex: i, choseOurs: true },
      { sampleIndex: i, choseOurs: i < 9 },
    ]).flat();
    // 샘플 9는 1:1 동수 → 범용 모델 쪽. 자사 승 9건/10건 → 충족
    const v = baselineVerdict(votes);
    expect(v.oursWins).toBe(9);
    expect(v.result).toBe("met");
  });
});

describe("4구역", () => {
  it("가능성 충족·수요 미달 = 빨간불, L1이면 잠정", () => {
    expect(automationZone({ verdict: "met", level: "L3" }, { verdict: "not_met", level: "L2" })).toEqual({
      zone: "red", provisional: false,
    });
    expect(automationZone({ verdict: "met", level: "L1" }, { verdict: "met", level: "L2" }).provisional).toBe(true);
    expect(automationZone({ verdict: "on_hold", level: "L2" }, { verdict: "met", level: "L2" }).zone).toBeNull();
  });
});

describe("근거 있는 수정·중단", () => {
  const base = { reasonType: "evidence" as const, verdictEvidenceLevel: "L2" as const, linkedToHypothesisAndEvidence: true };
  it("중단은 미달만", () => {
    expect(isGroundedChange({ ...base, choice: "stop", verdictResult: "not_met" })).toBe(true);
    expect(isGroundedChange({ ...base, choice: "stop", verdictResult: "on_hold" })).toBe(false);
  });
  it("수정은 충족 또는 미달, 외부 사정은 제외", () => {
    expect(isGroundedChange({ ...base, choice: "revise", verdictResult: "met" })).toBe(true);
    expect(isGroundedChange({ ...base, choice: "revise", verdictResult: "met", reasonType: "external" })).toBe(false);
  });
});

describe("권고", () => {
  it("치명 가설 미달은 확인 실험 먼저", () => {
    expect(recommend("not_met", "critical", false).recommendation).toBe("more_validation");
    expect(recommend("not_met", "critical", true).recommendation).toBe("stop");
  });
});

describe("인터뷰 품질", () => {
  it("유도·미래 가정 질문이 과반이면 신뢰 낮음", () => {
    expect(interviewQuality(["leading", "future", "past"]).lowTrust).toBe(true);
    expect(interviewQuality(["past", "past", "leading"]).lowTrust).toBe(false);
  });
});

describe("유닛 이코노믹스", () => {
  const inputs = {
    tasksPerUser: 100, callsPerTask: 2, inputTokens: 2000, outputTokens: 500,
    inputPricePerMTok: 4000, outputPricePerMTok: 20000, cacheSaving: 0.5, retryRate: 0.1,
    reviewHoursPerTask: 0, hourlyWage: 0, monthlyPrice: 30000,
  };
  it("작업당 비용과 시나리오", () => {
    const r = computeCostModel(inputs);
    // 호출 2.2회 × (2000×0.5×4000 + 500×20000)/1e6 = 2.2 × 14 = 30.8원
    expect(r.costPerTask.model).toBeCloseTo(30.8, 6);
    r.scenarios.forEach((s, i) => expect(s.heavyMultiplier).toBeCloseTo([1, 6.4, 8][i]!, 9));
    const observed = r.scenarios.find((s) => s.scenario === "observed")!;
    expect(observed.heavyMargin).toBeCloseTo(30000 - 3080 * 6.4, 6);
  });
  it("민감도: 10배 하락이면 손익분기 가격도 1/10", () => {
    const r = computeCostModel(inputs);
    expect(r.sensitivity[0]!.breakevenPrice).toBeCloseTo(308, 6);
  });
});

describe("우리 서비스 비용 구조", () => {
  it("가격 하한과 손익분기", () => {
    expect(priceFloor(48000, 0.52)).toBeCloseTo(100000, 6);
    const fixed = monthlyFixedCost({
      monthlyPeople: 20_000_000, monthlyInfraFixed: 500_000, monthlyCodingCheck: 300_000,
      legalReviewOnce: 3_000_000, initialCodingValidationOnce: 1_200_000,
      sycophancyCheckPerRun: 600_000, sycophancyRunsPerYear: 4,
    });
    expect(fixed).toBeCloseTo(20_800_000 + 6_600_000 / 12, 6);
    expect(breakevenProgramsPerMonth(fixed, 500_000, 50_000)).toBe(Math.ceil(fixed / 450_000));
    expect(breakevenProgramsPerMonth(fixed, 40_000, 50_000)).toBeNull();
  });
  it("Van Westendorp 범위", () => {
    const resp = Array.from({ length: 16 }, (_, i) => ({
      tooCheap: 50 + i * 5, cheap: 100 + i * 5, expensive: 200 + i * 5, tooExpensive: 300 + i * 5,
    }));
    const r = vanWestendorp(resp);
    expect(r.enoughRespondents).toBe(true);
    expect(r.pmc).not.toBeNull();
    expect(r.pme).not.toBeNull();
    expect(r.pmc!).toBeLessThan(r.pme!);
  });
});
