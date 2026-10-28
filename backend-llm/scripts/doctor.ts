// 환경 점검: 키와 연결이 맞는지 한 번에 확인한다.   npm run doctor
import "./_env";
import { createClient } from "@supabase/supabase-js";
import { explainAnthropicError } from "../src/lib/llm/client";

type Mark = "✓" | "✗" | "△";
const results: Array<[Mark, string]> = [];
const say = (m: Mark, msg: string) => {
  results.push([m, msg]);
  console.log(`${m} ${msg}`);
};
const env = process.env;
/** supabase/migrations의 마지막 파일 번호 (schema_version()이 돌려주는 값) */
const SCHEMA_VERSION = "20261024000700";

async function main() {
  console.log("검증실 환경 점검\n");
  if (env.DEMO_MODE === "1") say("△", "DEMO_MODE=1: Supabase 없이 메모리 DB로 돈다 (운영에서는 끈다)");

  // ── 필수 ─────────────────────────────────────────────
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    // 데모 모드는 Supabase 없이 돈다
    say(env[k] ? "✓" : env.DEMO_MODE === "1" ? "△" : "✗", `${k}${env[k] ? "" : env.DEMO_MODE === "1" ? " 없음 (데모 모드라 괜찮다)" : " 없음"}`);
  }
  // 자주 하는 실수: API 주소 자리에 DB 접속 문자열을 넣거나, 예시 값을 그대로 둠
  const apiUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (apiUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(apiUrl)) {
    say("✗", apiUrl.startsWith("postgres")
      ? "NEXT_PUBLIC_SUPABASE_URL에 DB 접속 문자열이 들어 있다. 이 값은 DATABASE_URL에 넣고, 여기에는 Project Settings → API의 Project URL(https://<id>.supabase.co)을 넣는다"
      : `NEXT_PUBLIC_SUPABASE_URL 형식이 이상하다 (${apiUrl}). Project Settings → API의 Project URL(https://<id>.supabase.co)을 넣는다`);
  }
  if (apiUrl.includes("xxxx")) say("✗", "NEXT_PUBLIC_SUPABASE_URL이 예시 값(xxxx) 그대로다");
  const dbUrl = env.DATABASE_URL ?? "";
  if (!dbUrl) say("△", "DATABASE_URL 없음 (npm run setup 때만 필요)");
  else if (dbUrl.includes("xxxx") || dbUrl.includes("<비밀번호>")) say("✗", "DATABASE_URL이 예시 값 그대로다 → Project Settings → Database → Connection string(URI)");
  else if (!dbUrl.startsWith("postgres")) say("✗", "DATABASE_URL은 postgresql://로 시작하는 DB 접속 문자열이어야 한다");
  else say("✓", "DATABASE_URL");
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    let db: ReturnType<typeof createClient>;
    try {
      db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    } catch (e) {
      say("✗", `NEXT_PUBLIC_SUPABASE_URL 형식: ${(e as Error).message}`);
      return finish();
    }
    const { error } = await db.from("projects").select("id").limit(1);
    if (error) say("✗", `Supabase 연결·스키마: ${error.message} → npm run setup`);
    else {
      say("✓", "Supabase 연결");
      const { data: ver, error: e2 } = await db.rpc("schema_version");
      const ok = !e2 && String(ver ?? "") >= SCHEMA_VERSION;
      say(ok ? "✓" : "✗", ok ? "마이그레이션 최신" : `최신 마이그레이션이 없다 → npm run setup${e2 ? ` (${e2.message})` : ` (DB ${String(ver)}, 코드 ${SCHEMA_VERSION})`}`);
      const { data: ex } = await db.from("projects").select("id").eq("is_example", true).limit(1);
      say(ex?.length ? "✓" : "△", ex?.length ? "예시 프로젝트" : "예시 프로젝트 없음 → npm run setup");
      const { data: buckets, error: be } = await db.storage.listBuckets();
      const names = (buckets ?? []).map((b) => b.name);
      const missing = ["raw-files", "proposal-pdfs", "source-files"].filter((b) => !names.includes(b));
      say(be || missing.length ? "✗" : "✓", be ? `저장소: ${be.message}` : missing.length ? `저장소 버킷 없음: ${missing.join(", ")} → npm run setup` : "저장소 버킷");
      const { count } = await db.from("price_table").select("model_name", { count: "exact", head: true });
      say(count ? "✓" : "△", count ? `모델 단가표 ${count}개` : "모델 단가표가 비어 있다 (비용 계산기에서 단가를 직접 넣어야 한다)");
    }
  }

  // ── LLM ──────────────────────────────────────────────
  const provider = env.LLM_PROVIDER ?? "anthropic";
  if (provider === "mock") say("△", "LLM_PROVIDER=mock: 고정 응답 (실제 분석을 하려면 anthropic)");
  else if (!env.ANTHROPIC_API_KEY) say("✗", "ANTHROPIC_API_KEY 없음");
  else {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) say("✗", `Anthropic 키: ${explainAnthropicError(res.status, await res.text(), env.ANTHROPIC_MODEL ?? "")}`);
      else {
        const data = (await res.json()) as { data: Array<{ id: string }> };
        const ids = data.data.map((m) => m.id);
        const want = [env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", env.BASELINE_MODEL ?? "claude-haiku-5-5"];
        say("✓", "Anthropic 키");
        for (const m of want) say(ids.includes(m) ? "✓" : "△", ids.includes(m) ? `모델 ${m}` : `모델 ${m}을 목록에서 찾지 못했다 (별칭이면 괜찮다. 오류가 나면 ANTHROPIC_MODEL을 바꾼다)`);
        // 실제로 서비스와 같은 방식(도구 호출)으로 아주 짧게 한 번 불러 본다: 크레딧 부족·모델 권한은 여기서만 드러난다 (비용 1원 미만)
        for (const m of [...new Set(want)]) {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: m,
              max_tokens: 32,
              messages: [{ role: "user", content: "ok 라고만 답한다" }],
              tools: [{ name: "submit_result", description: "결과 제출", input_schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] } }],
              tool_choice: { type: "tool", name: "submit_result" },
            }),
            signal: AbortSignal.timeout(30_000),
          });
          say(r.ok ? "✓" : "✗", r.ok ? `모델 ${m} 실제 호출` : `모델 ${m} 실제 호출 실패: ${explainAnthropicError(r.status, await r.text(), m)}`);
        }
      }
    } catch (e) {
      say("✗", `Anthropic 연결: ${(e as Error).message}`);
    }
  }

  // ── 선택 ─────────────────────────────────────────────
  if (!env.ENCRYPTION_KEY) say("△", "ENCRYPTION_KEY 없음 (PostHog·Amplitude·Langfuse 연동을 못 한다)");
  else say(env.ENCRYPTION_KEY.length >= 32 ? "✓" : "✗", env.ENCRYPTION_KEY.length >= 32 ? "ENCRYPTION_KEY" : "ENCRYPTION_KEY가 32자보다 짧다 (서버는 연동 기능만 끄고 뜬다)");
  if (env.CRON_SECRET && env.CRON_SECRET.length < 16) say("✗", "CRON_SECRET이 16자보다 짧다 (서버는 예약 작업 인증을 끄고 뜬다)");
  say(env.CRON_SECRET && env.CRON_SECRET.length >= 16 ? "✓" : "△", env.CRON_SECRET ? "CRON_SECRET" : "CRON_SECRET 없음 (매일 예약 작업: 연동 가져오기·기한 알림·보관 기간 정리가 돌지 않는다)");
  say(env.ADMIN_EMAILS ? "✓" : "△", env.ADMIN_EMAILS ? `운영자: ${env.ADMIN_EMAILS}` : "ADMIN_EMAILS 없음 (운영자 화면에 아무도 못 들어간다)");
  say(env.RESEND_API_KEY ? "✓" : "△", env.RESEND_API_KEY ? `메일 알림 (보내는 주소: ${env.MAIL_FROM ?? "기본값"})` : "RESEND_API_KEY 없음 (화면 알림만 보낸다)");
  if (env.VOYAGE_API_KEY) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.VOYAGE_API_KEY}` },
        body: JSON.stringify({ input: ["test"], model: env.VOYAGE_MODEL ?? "voyage-3.5", output_dimension: 1024 }),
        signal: AbortSignal.timeout(15_000),
      });
      say(res.ok ? "✓" : "✗", res.ok ? "Voyage 임베딩 (WORKBank 사전값)" : `Voyage 키: ${res.status}`);
    } catch (e) {
      say("✗", `Voyage 연결: ${(e as Error).message}`);
    }
  } else say("△", "VOYAGE_API_KEY 없음 (WORKBank 수요 사전값을 비워 둔다. 판정에는 영향 없음)");
  const app = env.APP_URL ?? "http://localhost:3000";
  say(app.startsWith("https://") || app.includes("localhost") ? "✓" : "△", `APP_URL ${app}`);

  finish();
}

function finish(): never {
  const bad = results.filter(([m]) => m === "✗").length;
  console.log(`\n${bad ? `✗ 고칠 것 ${bad}개` : "✓ 필수 항목 모두 통과"}`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(`✗ 점검 중 오류: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
