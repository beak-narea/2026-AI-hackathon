import { describe, expect, it } from "vitest";
import { betaCdf, binomPmf } from "@/lib/stats/beta";
import {
  conclusionProbability, decisionBounds, decisionTable, judge, requiredSampleSize, wilson, zeroEventUpperBound,
} from "@/lib/stats/verdict";
import { designEffect, effectiveSample } from "@/lib/stats/cluster";

// 기대값은 scipy.stats(beta, binom)로 계산해 기획 문서에 적은 값이다.
const T60 = { target: 0.6, min: 0.4 };

describe("베타 분포", () => {
  it("scipy와 같은 값", () => {
    expect(betaCdf(0.4, 3.5, 7.5)).toBeCloseTo(0.734925, 5);
    expect(betaCdf(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 10);
    expect(betaCdf(0.3, 2, 5)).toBeCloseTo(0.579825, 5);
    expect(binomPmf(3, 10, 0.4)).toBeCloseTo(0.214991, 5);
  });
});

describe("작은 표본 결정표 (목표 60%, 최소 40%)", () => {
  const expected: Record<number, [number, number]> = {
    5: [4, 1], 8: [6, 2], 10: [8, 2], 15: [11, 4], 20: [14, 6], 30: [21, 9],
  };
  for (const [n, [met, fail]] of Object.entries(expected)) {
    it(`${n}명: ${met}명 이상 충족, ${fail}명 이하 미달`, () => {
      const b = decisionBounds(Number(n), T60);
      expect(b.metFrom).toBe(met);
      expect(b.failTo).toBe(fail);
    });
  }
  it("보류 구간", () => {
    const [row] = decisionTable([10], T60);
    expect(row).toMatchObject({ holdFrom: 3, holdTo: 7 });
  });
});

describe("오판율 표", () => {
  it("10명: 반대 방향 오판 1.2%, 70%일 때 충족 38%, 60%일 때 보류 82%", () => {
    expect(conclusionProbability(10, T60, 0.4).pMet).toBeCloseTo(0.0123, 3);
    expect(conclusionProbability(10, T60, 0.6).pNotMet).toBeCloseTo(0.0123, 3);
    expect(conclusionProbability(10, T60, 0.7).pMet).toBeCloseTo(0.383, 2);
    expect(conclusionProbability(10, T60, 0.6).pHold).toBeCloseTo(0.82, 2);
  });
  it("20명: 0.7%, 61%, 74%", () => {
    expect(conclusionProbability(20, T60, 0.4).pMet).toBeCloseTo(0.0065, 3);
    expect(conclusionProbability(20, T60, 0.7).pMet).toBeCloseTo(0.608, 2);
    expect(conclusionProbability(20, T60, 0.6).pHold).toBeCloseTo(0.744, 2);
  });
  it("판정 기준 90%면 30명 보류 91%", () => {
    expect(conclusionProbability(30, T60, 0.6, 0.9).pHold).toBeCloseTo(0.906, 2);
  });
});

describe("표본 크기", () => {
  it("75% 예상이면 30명에서 80%", () => {
    expect(conclusionProbability(30, T60, 0.75).pConclusive).toBeGreaterThanOrEqual(0.8);
  });
  it("70% 예상이면 70명에서 82%", () => {
    expect(conclusionProbability(70, T60, 0.7).pConclusive).toBeCloseTo(0.82, 2);
    const plan = requiredSampleSize(T60, 0.7);
    expect(plan?.n).toBeLessThanOrEqual(70);
  });
});

describe("성공 기준 팀 수", () => {
  it("결정 변화 20팀: 10팀 충족, 2팀 미달 / 10팀: 6팀, 0팀", () => {
    expect(decisionBounds(20, { target: 0.4, min: 0.2 })).toMatchObject({ metFrom: 10, failTo: 2 });
    expect(decisionBounds(10, { target: 0.4, min: 0.2 })).toMatchObject({ metFrom: 6, failTo: 0 });
  });
  it("지불 20팀: 7팀 충족, 0팀 미달 / 10팀: 4팀", () => {
    expect(decisionBounds(20, { target: 0.25, min: 0.1 })).toMatchObject({ metFrom: 7, failTo: 0 });
    expect(decisionBounds(10, { target: 0.25, min: 0.1 }).metFrom).toBe(4);
  });
  it("결정 변화 실제 50%면 20팀 결론 확률 59%, 75팀 82%", () => {
    expect(conclusionProbability(20, { target: 0.4, min: 0.2 }, 0.5).pConclusive).toBeCloseTo(0.588, 2);
    expect(conclusionProbability(70, { target: 0.4, min: 0.2 }, 0.5).pConclusive).toBeLessThan(0.8);
    expect(conclusionProbability(75, { target: 0.4, min: 0.2 }, 0.5).pConclusive).toBeCloseTo(0.822, 2);
  });
  it("지불 실제 25%면 20팀 결론 확률 22%", () => {
    expect(conclusionProbability(20, { target: 0.25, min: 0.1 }, 0.25).pConclusive).toBeCloseTo(0.217, 2);
  });
});

describe("판정과 재판정 상한", () => {
  it("4회째 보류는 결론 없음", () => {
    expect(judge({ successes: 5, n: 10, ...T60, look: 3 }).result).toBe("on_hold");
    expect(judge({ successes: 5, n: 10, ...T60, look: 4 }).result).toBe("no_conclusion");
    expect(() => judge({ successes: 5, n: 10, ...T60, look: 5 })).toThrow();
  });
  it("0명이면 보류", () => {
    expect(judge({ successes: 0, n: 0, ...T60 }).result).toBe("on_hold");
  });
  it("기준선 테스트 10건: 9건 충족, 3건 미달", () => {
    expect(decisionBounds(10, { target: 0.7, min: 0.5 })).toMatchObject({ metFrom: 9, failTo: 3 });
  });
});

describe("보조 통계", () => {
  it("Wilson 36/45 = 66~89%", () => {
    const [lo, hi] = wilson(36, 45);
    expect(lo).toBeCloseTo(0.662, 2);
    expect(hi).toBeCloseTo(0.891, 2);
  });
  it("0건 규칙: 10명 중 0명 → 30%, 정확한 값 26%", () => {
    const z = zeroEventUpperBound(10);
    expect(z.ruleOfThree).toBeCloseTo(0.3);
    expect(z.exact).toBeCloseTo(0.2589, 3);
  });
  it("설계 효과: 회사당 3명, ICC 0.2 → 1.4, 유효 표본 71%", () => {
    expect(designEffect(3, 0.2)).toBeCloseTo(1.4);
    const e = effectiveSample({ n: 30, successes: 15, clusters: 10, icc: 0.2 });
    expect(e.n / 30).toBeCloseTo(0.714, 2);
  });
  it("ICC가 없으면 묶음 단위", () => {
    const e = effectiveSample({ n: 30, successes: 15, clusters: 10, clusterSuccesses: 6 });
    expect(e).toMatchObject({ n: 10, successes: 6, method: "cluster_unit" });
  });
});
