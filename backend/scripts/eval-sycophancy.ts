// 아첨 점검 3종 실행: 약점 탐지, 표현 바꾸기, 반박. 결과는 eval_runs에 남고 운영자 화면에서 채점기 라벨을 단다.
//   npm run eval:sycophancy              (3종 모두)
//   npm run eval:sycophancy -- pushback  (하나만)
// 실제 모델로 수백 번 호출한다 (약 300회). LLM_PROVIDER=mock 이면 고정 응답으로 흐름만 확인한다.
import { requireEnv } from "./_env";
import { createClient } from "@supabase/supabase-js";
import { LlmClient, anthropicTransport } from "../src/lib/llm/client";
import { mockTransport } from "../src/lib/llm/mock";
import { EVAL_KINDS, gateStatus, runAndStore, type EvalKind } from "../src/lib/eval/sycophancy";

async function main() {
  requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const env = process.env;
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const model = env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const mock = env.LLM_PROVIDER === "mock";
  if (!mock && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 필요하다 (또는 LLM_PROVIDER=mock)");
  const llm = new LlmClient(
    mock ? mockTransport : anthropicTransport(env.ANTHROPIC_API_KEY!),
    model,
    { inputPerMTokKrw: Number(env.LLM_INPUT_PRICE_PER_MTOK_KRW ?? 4200), outputPerMTokKrw: Number(env.LLM_OUTPUT_PRICE_PER_MTOK_KRW ?? 21000) },
    async (r) => {
      await db.from("llm_calls").insert({
        purpose: r.purpose, prompt_version: r.promptVersion, model: r.model, input_tokens: r.inputTokens, output_tokens: r.outputTokens,
        cost_krw: r.costKrw, latency_ms: r.latencyMs, ok: r.ok, error: r.error ?? null,
      });
    },
  );
  const asked = process.argv.slice(2).filter((a) => (EVAL_KINDS as string[]).includes(a)) as EvalKind[];
  for (const kind of asked.length ? asked : EVAL_KINDS) {
    console.log(`\n▶ ${kind}`);
    const r = await runAndStore(db, llm, model, kind, (m) => console.log(`  ${m}`));
    console.log(`  결과: ${JSON.stringify(r.metrics)}`);
    console.log(`  ${r.passed ? "✓ 통과" : `✗ ${r.reasons.join(" / ")}`}`);
  }
  const gate = await gateStatus(db, model);
  console.log(`\n배포 전 점검(지문 ${gate.versions_hash}): ${gate.passed ? "✓ 통과" : "✗ 미통과"}`);
  console.log("채점기 라벨은 운영자 화면 → 품질 점검에서 단다 (사람 라벨 150개, κ ≥ 0.65).");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
