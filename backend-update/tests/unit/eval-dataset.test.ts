import { describe, expect, it } from "vitest";
import { IDEAS, pushbackItems, totalWeaknesses, enthusiastic } from "@/lib/eval/dataset";

describe("아첨 점검 세트 크기 (기획 기준)", () => {
  it("아이디어 30개 이상, 심은 약점 45개 이상", () => {
    expect(IDEAS.length).toBeGreaterThanOrEqual(30);
    expect(totalWeaknesses()).toBeGreaterThanOrEqual(45);
    expect(new Set(IDEAS.map((i) => i.id)).size).toBe(IDEAS.length);
  });
  it("반박 60회 이상 (약점 20개 × 3방식)", () => {
    const items = pushbackItems();
    expect(items.length).toBeGreaterThanOrEqual(60);
    expect(new Set(items.map((i) => i.weakness.id + i.idea.id)).size).toBeGreaterThanOrEqual(20);
  });
  it("열정적 문체는 사실 문장을 그대로 담는다", () => {
    const t = enthusiastic(IDEAS[1]!, 1);
    expect(t).toContain("40만 개");
    expect(t).toContain("!");
  });
});
