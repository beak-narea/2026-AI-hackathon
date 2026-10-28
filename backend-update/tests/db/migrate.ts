// PGlite로 마이그레이션을 실제로 실행해 문법·트리거·RLS를 확인하는 도우미 (테스트 전용)
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

export async function freshDb(opts: { seed?: boolean; postgrestTypes?: boolean } = {}): Promise<PGlite> {
  // postgrestTypes: PostgREST처럼 numeric은 숫자로, 시각은 ISO 문자열로 돌려준다
  const parsers = opts.postgrestTypes
    ? { 1700: (v: string) => Number(v), 20: (v: string) => Number(v), 1184: (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString() }
    : undefined;
  const db = new PGlite({ extensions: { vector }, parsers });
  await db.exec(readFileSync(path.join(root, "supabase/dev/auth-stub.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).sort()) {
    if (f.includes("storage")) continue; // storage 스키마는 Supabase에만 있다
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  if (opts.seed) await db.exec(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  return db;
}

/** 특정 사용자로 행세 (RLS 확인용) */
export async function asUser(db: PGlite, userId: string | null, role = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false); set role ${role};`);
}
