import "server-only";
import { serverEnv } from "../env";
import { LlmClient, anthropicTransport, type LlmPricing, type LlmTransport, type LlmLogger, type StructuredCall } from "./client";
import { mockTransport } from "./mock";
import type { Db } from "../supabase/server";
import { ApiError } from "../api/handler";
import { rateLimit } from "../api/guards";

/** 이번 달 1일 0시 (한국 시간) */
export function monthStart(d = new Date()): string {
  const KST = 9 * 3600_000;
  const k = new Date(d.getTime() + KST);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KST).toISOString();
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
  if (env.LLM_PROVIDER !== "mock" && !env.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "misconfigured", "ANTHROPIC_API_KEY가 없어 AI 기능을 쓸 수 없다. .env.local에 키를 넣고 서버를 다시 켠다 (npm run doctor로 확인).");
  }
  const transport = env.LLM_PROVIDER === "mock" ? mockTransport : anthropicTransport(env.ANTHROPIC_API_KEY!);
  const used = model ?? env.ANTHROPIC_MODEL;
  // 기준선 테스트용 작은 모델은 그 모델 단가로 기록한다 (비용·한도가 부풀지 않게)
  const pricing =
    used === env.BASELINE_MODEL && used !== env.ANTHROPIC_MODEL
      ? { inputPerMTokKrw: env.BASELINE_INPUT_PRICE_PER_MTOK_KRW, outputPerMTokKrw: env.BASELINE_OUTPUT_PRICE_PER_MTOK_KRW }
      : { inputPerMTokKrw: env.LLM_INPUT_PRICE_PER_MTOK_KRW, outputPerMTokKrw: env.LLM_OUTPUT_PRICE_PER_MTOK_KRW };
  return new GuardedLlmClient(
    transport,
    used,
    pricing,
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
