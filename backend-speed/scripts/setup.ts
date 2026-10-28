// 처음 한 번: Supabase DB에 마이그레이션·예시 프로젝트를 넣고 저장소 버킷을 확인한다. 여러 번 실행해도 안전하다.
//   필요: DATABASE_URL (Supabase → Project Settings → Database → Connection string, URI)
//   npm run setup
import "./_env";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const EXAMPLE_ID = "00000000-0000-4000-8000-000000000001";

// 이미 손으로 적용한 경우를 알아보는 표식 (SQL Editor로 먼저 실행했을 때)
const MARKERS: Record<string, string> = {
  // 같은 이름의 다른 projects 테이블과 헷갈리지 않게, 이 스키마만의 타입·열까지 본다
  "20261024000100_schema.sql":
    "select to_regtype('public.project_status') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name = 'is_example') as ok",
  "20261024000200_rules_and_rls.sql": "select exists (select 1 from pg_proc where proname = 'is_project_editor') as ok",
  "20261024000300_storage.sql": "select exists (select 1 from pg_policies where policyname = 'storage_read_members') as ok",
  "20261024000400_extensions.sql": "select to_regclass('public.raw_files') is not null as ok",
  "20261024000500_hardening.sql": "select exists (select 1 from pg_proc where proname = 'llm_cost_since') as ok",
  // 20261024000600_storage_hardening.sql 은 여러 번 실행해도 같은 결과라 표식 없이 실행한다
  "20261024000700_integrity.sql": "select to_regclass('public.project_members_user_once') is not null as ok",
};

/** SSL: URL에 sslmode가 있으면 따르고, 없으면 로컬·컨테이너 이름(점 없는 호스트)만 끈다 */
function sslFor(url: string): false | "require" {
  try {
    const u = new URL(url);
    const mode = u.searchParams.get("sslmode");
    if (mode === "disable") return false;
    if (mode) return "require";
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "host.docker.internal" || !host.includes(".")) return false;
  } catch {
    // postgres.js가 형식 오류를 알려 준다
  }
  return "require";
}

/** Supabase CLI(npm run db:push)가 같은 마이그레이션을 다시 적용하지 않도록 CLI 기록에도 남긴다 */
async function recordForCli(sql: postgres.Sql, file: string) {
  const [has] = await sql`select to_regclass('supabase_migrations.schema_migrations') is not null as ok`;
  if (!has?.ok) return;
  const m = file.match(/^(\d+)_(.+)\.sql$/);
  if (!m) return;
  try {
    await sql`insert into supabase_migrations.schema_migrations (version, name) values (${m[1]!}, ${m[2]!}) on conflict (version) do nothing`;
  } catch {
    // 오래된 CLI 표에는 name 열이 없다
    await sql`insert into supabase_migrations.schema_migrations (version) values (${m[1]!}) on conflict (version) do nothing`.catch(() => {});
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL이 없다. Supabase → Project Settings → Database → Connection string(URI)을 .env.local에 넣는다.");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, ssl: sslFor(url), onnotice: () => {} });
  try {
    await sql`create table if not exists public._app_migrations (name text primary key, applied_at timestamptz not null default now())`;
    // vector 확장이 public 등 다른 스키마에 이미 있으면 extensions 스키마로 옮긴다 (스키마가 extensions.vector를 쓴다)
    const [vec] = await sql`select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`;
    if (vec && vec.schema !== "extensions") {
      await sql`create schema if not exists extensions`;
      await sql.unsafe("alter extension vector set schema extensions");
      console.log(`· vector 확장을 ${vec.schema} → extensions 스키마로 옮겼다`);
    }
    const dir = path.resolve("supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const [done] = await sql`select 1 from public._app_migrations where name = ${file}`;
      if (done) {
        await recordForCli(sql, file);
        console.log(`· ${file} (이미 적용)`);
        continue;
      }
      const marker = MARKERS[file];
      if (marker) {
        const [r] = await sql.unsafe(marker);
        if (r?.ok) {
          await sql`insert into public._app_migrations (name) values (${file})`;
          await recordForCli(sql, file);
          console.log(`· ${file} (이미 있는 것을 확인하고 기록만 함)`);
          continue;
        }
      }
      const body = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public._app_migrations (name) values (${file})`;
      });
      await recordForCli(sql, file);
      console.log(`✓ ${file}`);
    }
    // Supabase API(PostgREST)가 새 테이블을 바로 알아보게 스키마 목록을 다시 읽힌다
    await sql`notify pgrst, 'reload schema'`.catch(() => {});
    await sql`revoke all on public._app_migrations from anon, authenticated`;
    await sql`alter table public._app_migrations enable row level security`;

    const [example] = await sql`select 1 from public.projects where id = ${EXAMPLE_ID}`;
    if (example) console.log("· 예시 프로젝트 (이미 있음)");
    else {
      // seed.sql은 자기 begin/commit을 갖고 있어 바깥 트랜잭션 없이 실행한다
      const seed = readFileSync(path.resolve("supabase/seed.sql"), "utf8");
      if (!seed.includes(EXAMPLE_ID)) throw new Error("supabase/seed.sql이 비었거나 깨졌다. npm run seed:generate를 다시 실행한다.");
      await sql.unsafe(seed);
      const [ok] = await sql`select 1 from public.projects where id = ${EXAMPLE_ID}`;
      if (!ok) throw new Error("seed.sql을 실행했지만 예시 프로젝트가 없다");
      console.log("✓ 예시 프로젝트");
    }

    const buckets = await sql`select id from storage.buckets where id in ('raw-files', 'proposal-pdfs', 'source-files')`;
    console.log(buckets.length === 3 ? "✓ 저장소 버킷 3개" : `✗ 저장소 버킷이 ${buckets.length}개다 (raw-files, proposal-pdfs, source-files 필요)`);

    const [row] = await sql`select count(*)::int as n from public.price_table`;
    if (row?.n === 0) console.log("△ 모델 단가표(price_table)가 비어 있다. 운영자가 월 1회 갱신한다.");

    console.log(`
남은 일 (Supabase 대시보드):
  1. Authentication → URL Configuration → Site URL = ${process.env.APP_URL ?? "<배포 주소>"}
  2. Redirect URLs에 ${(process.env.APP_URL ?? "<배포 주소>").replace(/\/$/, "")}/auth/callback 추가
  3. (선택) Authentication → Emails 에서 메일 문구를 한국어로
그다음: npm run doctor`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("✗ 설정 실패:", e instanceof Error ? e.message : e);
  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/.test(msg) && /db\.[a-z0-9]+\.supabase\.co/.test(msg + (process.env.DATABASE_URL ?? ""))) {
    console.error(`  → db.<id>.supabase.co 직접 접속 주소는 IPv6만 지원해 집·학교 인터넷에서 안 열리는 경우가 많다.
    Supabase 대시보드 위쪽 [Connect] → Session pooler 의 URI(…pooler.supabase.com:5432)를 DATABASE_URL에 넣고 다시 실행한다.`);
  }
  process.exit(1);
});
