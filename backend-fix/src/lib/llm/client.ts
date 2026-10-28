// LLM 계층: 모든 모델 호출을 한 곳에 모은다.
// - 출력은 JSON 스키마로 고정 (도구 호출 강제 + zod 검증, 실패 시 1회 재시도)
// - 호출마다 목적·프롬프트 버전·모델·토큰·비용·지연을 기록
// - LLM은 판정 점수를 내지 않는다. 스키마에 점수 필드를 두지 않는다.

import { z } from "zod";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmTransportRequest {
  purpose: string;
  model: string;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  images?: LlmImage[];
}

export interface LlmImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** base64 */
  data: string;
}

export interface LlmTransportResponse {
  toolInput: unknown;
  usage: LlmUsage;
}

/** 실제 API 호출을 바꿔 끼울 수 있게 분리 (테스트·mock 모드) */
export type LlmTransport = (req: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface LlmCallRecord {
  purpose: string;
  promptVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costKrw: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export type LlmLogger = (record: LlmCallRecord) => Promise<void> | void;

export interface LlmPricing {
  inputPerMTokKrw: number;
  outputPerMTokKrw: number;
}

export interface StructuredCall<T> {
  purpose: string;
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** 스키마를 설명하는 한 문장 (도구 설명) */
  description: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  images?: LlmImage[];
}

export class LlmError extends Error {
  constructor(message: string, readonly purpose: string) {
    super(message);
  }
}

export function anthropicTransport(apiKey: string, baseUrl = "https://api.anthropic.com"): LlmTransport {
  return async (req) => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: [
          {
            role: "user",
            content: [
              ...(req.images ?? []).map((img) => ({
                type: "image",
                source: { type: "base64", media_type: img.mediaType, data: img.data },
              })),
              { type: "text", text: req.user },
            ],
          },
        ],
        tools: [{ name: req.toolName, description: req.toolDescription, input_schema: req.inputSchema }],
        tool_choice: { type: "tool", name: req.toolName },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; name?: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const tool = data.content.find((c) => c.type === "tool_use" && c.name === req.toolName);
    if (!tool) throw new Error("모델이 구조화된 결과를 돌려주지 않았다");
    return {
      toolInput: tool.input,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    };
  };
}

export class LlmClient {
  constructor(
    private readonly transport: LlmTransport,
    private readonly defaultModel: string,
    private readonly pricing: LlmPricing,
    private readonly logger: LlmLogger = () => {},
  ) {}

  cost(usage: LlmUsage): number {
    return (
      (usage.inputTokens * this.pricing.inputPerMTokKrw + usage.outputTokens * this.pricing.outputPerMTokKrw) / 1e6
    );
  }

  async structured<T>(call: StructuredCall<T>): Promise<T> {
    const model = call.model ?? this.defaultModel;
    const inputSchema = z.toJSONSchema(call.schema, { target: "draft-7" }) as Record<string, unknown>;
    delete inputSchema.$schema;
    let user = call.user;
    let lastError = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
      try {
        const res = await this.transport({
          purpose: call.purpose,
          model,
          system: call.system,
          user,
          toolName: "submit_result",
          toolDescription: call.description,
          inputSchema,
          maxTokens: call.maxTokens ?? 4096,
          temperature: call.temperature ?? 0.2,
          images: call.images,
        });
        usage = res.usage;
        const parsed = call.schema.safeParse(res.toolInput);
        if (!parsed.success) {
          lastError = z.prettifyError(parsed.error);
          await this.log(call, model, usage, started, false, `schema: ${lastError}`);
          user = `${call.user}\n\n[이전 응답이 스키마를 어겼다. 아래 오류를 고쳐 다시 제출하라]\n${lastError}`;
          continue;
        }
        await this.log(call, model, usage, started, true);
        return parsed.data;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        await this.log(call, model, usage, started, false, lastError);
        // 요청 자체가 잘못된 4xx(키·모델 이름·형식)는 다시 보내도 같다. 한도 초과(429)·과부하(529)·시간 초과만 다시 시도한다.
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) break;
        if (attempt === 2) break;
      }
    }
    throw new LlmError(`LLM 호출 실패 (${call.purpose}): ${lastError}`, call.purpose);
  }

  private async log(call: StructuredCall<unknown>, model: string, usage: LlmUsage, started: number, ok: boolean, error?: string) {
    try {
      await this.logger({
        purpose: call.purpose,
        promptVersion: call.promptVersion,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costKrw: this.cost(usage),
        latencyMs: Date.now() - started,
        ok,
        error,
      });
    } catch {
      // 기록 실패가 사용자 요청을 막지 않게 한다
    }
  }
}
