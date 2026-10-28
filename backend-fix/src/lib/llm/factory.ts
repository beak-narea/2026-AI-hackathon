import "server-only";
import { serverEnv } from "../env";
import { LlmClient, anthropicTransport, type LlmPricing, type LlmTransport, type LlmLogger, type StructuredCall } from "./client";
import { mockTransport } from "./mock";
import type { Db } from "../supabase/server";
import { ApiError } from "../api/handler";
import { rateLimit } from "../api/guards";

export function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** 이번 달 프로젝트 LLM 비용 (원) */
export async function monthlyLlmCost(admin: Db, projectId: string): Promise<number> {
  // 합계는 DB에서 계산한다 (응답 1000행 제한에 걸려 한도가 작동하지 않는 일이 없게)
  const { data, error } = await admin.rpc("llm_cost_since", { p: projectId, since: monthStart() });
  if (error) throw new Error(`AI 사용량 확인 실패: ${error.message}`);
  return Number(data ?? 0);
}

/** 호출 전 비용 상한·요청 제한을 확인하는 클라이언트 */
class GuardedLlmClient extends LlmClient {
  constructor(
    transport: LlmTransport,
    model: string,
    pricing: LlmPricing,
    logger: LlmLogger,
    private readonly guard: () => Promise<void>,
  ) {
    super(transport, model, pricing, logger);
  }
  override async structured<T>(call: StructuredCall<T>): Promise<T> {
    await this.guard();
    return super.structured(call);
  }
}

/** 프로젝트·사용자 단위로 호출을 llm_calls에 기록하는 클라이언트 */
export function llmFor(admin: Db, projectId: string | null, userId: string | null, model?: string): LlmClient {
  const env = serverEnv();
  const transport = env.LLM_PROVIDER === "mock" ? mockTransport : anthropicTransport(env.ANTHROPIC_API_KEY!);
  return new GuardedLlmClient(
    transport,
    model ?? env.ANTHROPIC_MODEL,
    { inputPerMTokKrw: env.LLM_INPUT_PRICE_PER_MTOK_KRW, outputPerMTokKrw: env.LLM_OUTPUT_PRICE_PER_MTOK_KRW },
    async (r) => {
      await admin.from("llm_calls").insert({
        project_id: projectId,
        user_id: userId,
        purpose: r.purpose,
        prompt_version: r.promptVersion,
        model: r.model,
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
        cost_krw: r.costKrw,
        latency_ms: r.latencyMs,
        ok: r.ok,
        error: r.error ?? null,
      });
    },
    async () => {
      if (userId) await rateLimit(admin, `llm:${userId}`, env.LLM_CALLS_PER_HOUR, 3600);
      const cap = env.PROJECT_MONTHLY_LLM_BUDGET_KRW;
      if (projectId && cap > 0) {
        const used = await monthlyLlmCost(admin, projectId);
        if (used >= cap) {
          throw new ApiError(429, "llm_budget_exceeded", `이 프로젝트의 이번 달 AI 사용 한도(${cap.toLocaleString("ko-KR")}원)를 넘었다. 다음 달에 다시 쓰거나 운영자에게 한도 조정을 요청한다.`);
        }
      }
    },
  );
}
