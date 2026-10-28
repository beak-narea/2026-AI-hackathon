// 환경 점검: 키와 연결이 맞는지 한 번에 확인한다.   npm run doctor
import "./_env";
import { createClient } from "@supabase/supabase-js";

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
      if (!res.ok) say("✗", `Anthropic 키: ${res.status} ${(await res.text()).slice(0, 120)}`);
      else {
        const data = (await res.json()) as { data: Array<{ id: string }> };
        const ids = data.data.map((m) => m.id);
        const want = [env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", env.BASELINE_MODEL ?? "claude-haiku-5-5"];
        say("✓", "Anthropic 키");
        for (const m of want) say(ids.includes(m) ? "✓" : "△", ids.includes(m) ? `모델 ${m}` : `모델 ${m}을 목록에서 찾지 못했다 (별칭이면 괜찮다. 오류가 나면 ANTHROPIC_MODEL을 바꾼다)`);
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
