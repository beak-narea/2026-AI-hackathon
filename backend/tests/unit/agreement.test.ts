import { describe, expect, it } from "vitest";
import { cohenKappa, gate, krippendorffAlpha } from "@/lib/reliability/agreement";

// 기대값: Python krippendorff 0.8.1 / scikit-learn cohen_kappa_score
const N = null;
describe("Krippendorff α", () => {
  const d1 = [
    [1, 2, 3, 3, 2, 1, 4, 1, 2, N, N, N],
    [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, N, 3],
    [N, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, N],
    [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, N],
  ];
  it("Krippendorff 예제 (명목·순서·간격)", () => {
    expect(krippendorffAlpha(d1, "nominal")).toBeCloseTo(0.743421052631579, 10);
    expect(krippendorffAlpha(d1, "ordinal")).toBeCloseTo(0.8153875037548814, 10);
    expect(krippendorffAlpha(d1, "interval")).toBeCloseTo(0.8491071428571428, 10);
  });
  it("있음/없음 코드", () => {
    expect(krippendorffAlpha([[0, 1, 1, 0, 1, 0, 0, 1, 1, 1], [0, 1, 0, 0, 1, 0, 1, 1, 1, 1]], "nominal")).toBeCloseTo(0.6041666666666666, 10);
  });
  it("중요도 3단계 순서 척도 (빈칸 포함)", () => {
    const d = [
      [0, 1, 2, 2, 1, 0, 2, 1],
      [0, 1, 2, 1, 1, 0, 2, 2],
      [0, 2, 2, 2, 1, N, 2, 1],
    ];
    expect(krippendorffAlpha(d, "ordinal", [0, 1, 2])).toBeCloseTo(0.7351170568561873, 10);
  });
  it("값이 모두 같으면 계산하지 않는다", () => {
    expect(krippendorffAlpha([[1, 1], [1, 1]])).toBeNull();
  });
});

describe("Cohen κ", () => {
  it("이진", () => {
    expect(cohenKappa([1, 1, 0, 1, 0, 0, 1, 1, 0, 1], [1, 0, 0, 1, 0, 1, 1, 1, 0, 1]).kappa).toBeCloseTo(0.5833333333333333, 10);
  });
  it("범주 3개", () => {
    expect(cohenKappa(["a", "b", "c", "a", "b", "c", "a", "a"], ["a", "b", "b", "a", "c", "c", "a", "b"]).kappa).toBeCloseTo(0.4285714285714286, 10);
  });
});

describe("코드 유형 적용 판정", () => {
  it("기준", () => {
    expect(gate(0.85, 110, 104)).toBe("auto");
    expect(gate(0.7, 110, 104)).toBe("review");
    expect(gate(0.6, 110, 104)).toBe("off");
    expect(gate(0.95, 50, 104)).toBe("off");
  });
});
