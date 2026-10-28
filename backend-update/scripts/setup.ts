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
  "20261024000100_schema.sql": "select to_regclass('public.projects') is not null as ok",
  "20261024000200_rules_and_rls.sql": "select exists (select 1 from pg_proc where proname = 'is_project_editor') as ok",
  "20261024000300_storage.sql": "select exists (select 1 from pg_policies where policyname = 'storage_read_members') as ok",
  "20261024000400_extensions.sql": "select to_regclass('public.raw_files') is not null as ok",
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL이 없다. Supabase → Project Settings → Database → Connection string(URI)을 .env.local에 넣는다.");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require", onnotice: () => {} });
  try {
    await sql`create table if not exists public._app_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const dir = path.resolve("supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const [done] = await sql`select 1 from public._app_migrations where name = ${file}`;
      if (done) {
        console.log(`· ${file} (이미 적용)`);
        continue;
      }
      const marker = MARKERS[file];
      if (marker) {
        const [r] = await sql.unsafe(marker);
        if (r?.ok) {
          await sql`insert into public._app_migrations (name) values (${file})`;
          console.log(`· ${file} (이미 있는 것을 확인하고 기록만 함)`);
          continue;
        }
      }
      const body = readFileSync(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public._app_migrations (name) values (${file})`;
      });
      console.log(`✓ ${file}`);
    }
    await sql`revoke all on public._app_migrations from anon, authenticated`;
    await sql`alter table public._app_migrations enable row level security`;

    const [example] = await sql`select 1 from public.projects where id = ${EXAMPLE_ID}`;
    if (example) console.log("· 예시 프로젝트 (이미 있음)");
    else {
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(path.resolve("supabase/seed.sql"), "utf8"));
      });
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
  process.exit(1);
});
