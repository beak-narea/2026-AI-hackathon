// Anthropic 호출 형식: 최신 모델은 tool_choice 강제를 받지 않으므로 JSON 스키마 구조화 출력으로 받는다
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { anthropicTransport, fixEnumCase, LlmClient, toStructuredOutputSchema } from "@/lib/llm/client";

let server: Server;
let base = "";
let lastBody: Record<string, unknown> = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const Schema = z.object({
  level: z.enum(["critical", "major", "minor"]),
  questions: z.array(z.string().min(2)).min(2).max(4),
  score_note: z.string().max(50).nullable(),
});

describe("Anthropic 구조화 출력", () => {
  it("tool_choice 없이 output_config.format으로 보내고, 받지 않는 제약은 설명으로 옮긴다", () => {
    const js = toStructuredOutputSchema(z.toJSONSchema(Schema, { target: "draft-7" })) as Record<string, any>;
    const txt = JSON.stringify(js);
    expect(txt).not.toMatch(/"(minLength|maxLength|maxItems|minimum|maximum)"/);
    expect(js.properties.questions.minItems).toBeUndefined();
    expect(js.properties.questions.description).toContain("2개 이상");
    expect(js.additionalProperties).toBe(false);
  });

  it("응답 본문의 JSON을 읽고, 대소문자가 바뀐 enum은 맞춰 준다", async () => {
    reply = {
      status: 200,
      body: { content: [{ type: "text", text: JSON.stringify({ level: "Critical", questions: ["질문 하나", "질문 둘"], score_note: null }) }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } },
    };
    const client = new LlmClient(anthropicTransport("sk-test", base), "claude-sonnet-5-5", { inputPerMTokKrw: 1, outputPerMTokKrw: 1 });
    const out = await client.structured({ purpose: "t", promptVersion: "1", system: "s", user: "u", schema: Schema, description: "테스트" });
    expect(out.level).toBe("critical");
    expect(lastBody.tool_choice).toBeUndefined();
    expect(lastBody.temperature).toBeUndefined();
    expect(lastBody.tools).toBeUndefined();
    expect((lastBody.output_config as any).format.type).toBe("json_schema");
  });

  it("모델이 거절하면 한국어 안내와 원문을 함께 돌려준다", async () => {
    reply = { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } } };
    const client = new LlmClient(anthropicTransport("sk-test", base), "claude-sonnet-5-5", { inputPerMTokKrw: 1, outputPerMTokKrw: 1 });
    await expect(client.structured({ purpose: "t", promptVersion: "1", system: "s", user: "u", schema: Schema, description: "테스트" })).rejects.toThrow(/크레딧이 부족/);
  });

  it("fixEnumCase는 배열·중첩·nullable 안의 enum도 맞춘다", () => {
    const js = z.toJSONSchema(z.object({ xs: z.array(z.object({ k: z.enum(["a_b"]).nullable() })) }), { target: "draft-7" });
    expect(fixEnumCase(js, { xs: [{ k: "A_B" }, { k: null }] })).toEqual({ xs: [{ k: "a_b" }, { k: null }] });
  });
});
