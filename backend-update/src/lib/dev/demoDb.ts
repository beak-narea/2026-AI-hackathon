// 로컬 데모 모드 (DEMO_MODE=1): Supabase 없이 PGlite(브라우저·Node에서 도는 Postgres)에 같은 마이그레이션과
// 예시 프로젝트를 올려 API 전체를 돌린다. 서버를 다시 켜면 데이터가 초기화된다. 운영 배포에는 쓰지 않는다.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { fakeSupabase } from "./fakeSupabase";

export const DEMO_USERS = [
  { id: "d0000000-0000-4000-8000-000000000001", email: "demo@example.com", name: "데모 사용자" },
  { id: "d0000000-0000-4000-8000-000000000002", email: "mentor@example.com", name: "데모 멘토" },
] as const;

type Client = Awaited<ReturnType<typeof fakeSupabase>>;
const g = globalThis as unknown as { __demoDb?: Promise<Client> };

async function init(): Promise<Client> {
  const root = process.cwd();
  const db = new PGlite({
    extensions: { vector },
    // PostgREST처럼 numeric은 숫자로, 시각은 ISO 문자열로
    parsers: {
      1700: (v: string) => Number(v),
      20: (v: string) => Number(v),
      1184: (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString(),
    },
  });
  await db.exec(readFileSync(path.join(root, "supabase/dev/auth-stub.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).sort()) {
    if (f.includes("storage")) continue;
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  await db.exec(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  for (const u of DEMO_USERS) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [
      u.id,
      u.email,
      JSON.stringify({ name: u.name }),
    ]);
  }
  console.log("[demo] PGlite 준비 완료 (예시 프로젝트 포함)");
  return fakeSupabase(db);
}

export function demoClient(): Promise<Client> {
  g.__demoDb ??= init();
  return g.__demoDb;
}
