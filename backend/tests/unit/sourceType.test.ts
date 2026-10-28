// 저장소가 형식을 비워 돌려줘도 첨부를 확장자로 알아본다
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sourceType } from "@/lib/services/sources";

describe("첨부 형식", () => {
  it("형식이 비었거나 octet-stream이면 확장자로 정한다", () => {
    expect(sourceType("p/1-deck.pdf", "")).toBe("pdf");
    expect(sourceType("p/1-deck.PDF", "application/octet-stream")).toBe("pdf");
    expect(sourceType("p/1-photo.jpeg", "")).toBe("image");
    expect(sourceType("p/1-photo.bin", "image/png")).toBe("image");
    expect(sourceType("p/1-memo.txt", "")).toBe("text");
    expect(sourceType("p/1-x.hwp", "application/octet-stream")).toBe("other");
  });
});
