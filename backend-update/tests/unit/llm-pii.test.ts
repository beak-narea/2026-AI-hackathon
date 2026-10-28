import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmClient, type LlmCallRecord, type LlmTransport } from "@/lib/llm/client";
import { verifyQuotes } from "@/lib/llm/quotes";
import { pseudonymize } from "@/lib/pii/pseudonymize";
import { mockTransport } from "@/lib/llm/mock";
import { transcriptPrompt, devilsAdvocatePrompt } from "@/lib/llm/prompts";

describe("LLM 클라이언트", () => {
  const schema = z.object({ answer: z.string() });
  const pricing = { inputPerMTokKrw: 1_000_000, outputPerMTokKrw: 2_000_000 };

  it("스키마를 어기면 오류를 붙여 1회 재시도하고 기록한다", async () => {
    const logs: LlmCallRecord[] = [];
    let calls = 0;
    const transport: LlmTransport = async (req) => {
      calls++;
      return {
        toolInput: calls === 1 ? { wrong: 1 } : { answer: req.user.includes("스키마를 어겼다") ? "ok" : "no" },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };
    const client = new LlmClient(transport, "m", pricing, (r) => void logs.push(r));
    const out = await client.structured({ purpose: "t", promptVersion: "v1", system: "s", user: "u", schema, description: "d" });
    expect(out.answer).toBe("ok");
    expect(logs.map((l) => l.ok)).toEqual([false, true]);
    expect(logs[1]!.costKrw).toBeCloseTo(10 + 10);
  });

  it("두 번 다 실패하면 오류", async () => {
    const transport: LlmTransport = async () => ({ toolInput: {}, usage: { inputTokens: 0, outputTokens: 0 } });
    const client = new LlmClient(transport, "m", pricing);
    await expect(
      client.structured({ purpose: "t", promptVersion: "v1", system: "s", user: "u", schema, description: "d" }),
    ).rejects.toThrow(/LLM 호출 실패/);
  });

  it("mock 응답은 모든 프롬프트 스키마를 통과한다", async () => {
    const client = new LlmClient(mockTransport, "mock", pricing);
    const t = await client.structured(transcriptPrompt("고객: 지금은 엑셀로 손으로 나눠요.\n인터뷰어: 지난번엔요?"));
    expect(verifyQuotes("고객: 지금은 엑셀로 손으로 나눠요.", t.insights).kept.length).toBe(1);
    const d = await client.structured(devilsAdvocatePrompt("bm", [{ id: "h1", statement: "s" }]));
    expect(d.ratings[0]!.hypothesis_id).toBe("h1");
  });
});

describe("인용 검증", () => {
  it("원문에 없는 인용과 인용이 없는 인사이트는 버린다", () => {
    const transcript = "고객: 매달 증빙을 손으로   나눠요.\n고객: 야근이 많아요.";
    const r = verifyQuotes(transcript, [
      { text: "a", code_type: "현재 해결 방법", is_interpretive: false, quotes: ["매달 증빙을 손으로 나눠요", "자동화를 원해요"] },
      { text: "b", code_type: "전환 동기", is_interpretive: true, quotes: ["AI가 필요해요"] },
    ]);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.quotes).toEqual(["매달 증빙을 손으로 나눠요"]);
    expect(r.droppedQuotes).toBe(2);
    expect(r.droppedInsights).toBe(1);
  });
});

describe("가명 처리", () => {
  it("이메일·전화·주민번호·사업자번호·이름·회사를 바꾸고 같은 값은 같은 가명", () => {
    const text = "김민수 대리(minsu@acme.co.kr, 010-1234-5678)가 말했다. 김민수 대리는 한빛세무회계 소속이고 사업자번호는 123-45-67890, 주민번호 900101-1234567.";
    const r = pseudonymize(text, { knownCompanies: ["한빛세무회계"] });
    expect(r.text).not.toMatch(/김민수|minsu@|010-1234|123-45-67890|900101|한빛세무회계/);
    expect(r.text.match(/\[이름1\]/g)?.length).toBe(2);
    expect(r.text).toContain("[회사1]");
    expect(r.counts.email).toBe(1);
  });

  it("기존 매핑을 이어서 쓴다", () => {
    const first = pseudonymize("박지영 님", {});
    const second = pseudonymize("박지영 님과 이서준 님", { existing: first.entries });
    expect(second.text).toBe("[이름1] 님과 [이름2] 님");
    expect(second.added.map((e) => e.original)).toEqual(["이서준"]);
  });

  it("호칭 앞 흔한 말은 이름으로 보지 않는다", () => {
    expect(pseudonymize("고객님이 말했다").text).toBe("고객님이 말했다");
  });
});
