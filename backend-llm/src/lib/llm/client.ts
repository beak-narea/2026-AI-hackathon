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

/** Anthropic 오류를 사용자가 할 일로 바꾼다 (원문은 뒤에 붙여 둔다) */
export function explainAnthropicError(status: number | undefined, body: string, model: string): string {
  let type = "";
  let message = body;
  try {
    const j = JSON.parse(body) as { error?: { type?: string; message?: string } };
    type = j.error?.type ?? "";
    message = j.error?.message ?? body;
  } catch {
    // 본문이 JSON이 아니다
  }
  const m = message.toLowerCase();
  let hint: string;
  if (status === 401 || type === "authentication_error") hint = "Anthropic API 키가 틀렸거나 지워졌습니다. .env.local의 ANTHROPIC_API_KEY를 확인하고 서버를 다시 켜세요.";
  else if (m.includes("credit balance") || m.includes("billing")) hint = "Anthropic 계정 크레딧이 부족합니다. console.anthropic.com → Settings → Billing에서 충전하세요.";
  else if (status === 404 || type === "not_found_error") hint = `모델 '${model}'을 쓸 수 없습니다. .env.local의 ANTHROPIC_MODEL(또는 BASELINE_MODEL)을 확인하세요.`;
  else if (status === 403 || type === "permission_error") hint = `이 API 키로는 모델 '${model}'을 쓸 권한이 없습니다. Anthropic 콘솔에서 키의 워크스페이스·권한을 확인하세요.`;
  else if (status === 429 || type === "rate_limit_error") hint = "Anthropic 요청 한도에 걸렸습니다. 1분쯤 뒤 다시 시도하세요.";
  else if (status === 529 || type === "overloaded_error") hint = "Anthropic 서버가 붐빕니다. 잠시 뒤 다시 시도하세요.";
  else if (status && status >= 500) hint = "Anthropic 서버 오류입니다. 잠시 뒤 다시 시도하세요.";
  else hint = "Anthropic이 요청을 거절했습니다.";
  return `${hint} (Anthropic ${status ?? ""} ${type}: ${message.slice(0, 300)})`;
}

export function anthropicTransport(apiKey: string, baseUrl = "https://api.anthropic.com"): LlmTransport {
  return async (req) => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/messages`, {
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
    } catch (e) {
      const why = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name;
      if (why === "TimeoutError") throw new Error("Anthropic 응답이 2분 안에 오지 않았습니다. 잠시 뒤 다시 시도하세요.");
      throw new Error(`Anthropic 서버에 연결하지 못했습니다 (${why}). 인터넷 연결이나 회사·학교 방화벽을 확인하세요.`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(explainAnthropicError(res.status, body, req.model)) as Error & { status?: number };
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
