// Supabase 클라이언트
// - userClient: 요청한 사용자의 세션(쿠키 또는 Authorization: Bearer)으로 인증을 확인한다.
// - adminClient: service role. 권한 확인 뒤 서버 계산 결과를 쓸 때 쓴다.
// - 데모 모드(DEMO_MODE=1)에서는 둘 다 PGlite 위의 흉내 클라이언트를 쓴다.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isDemo, serverEnv } from "../env";

export type Db = SupabaseClient;

export const DEMO_COOKIE = "demo_user";

export async function userClient(req?: Request): Promise<Db> {
  const env = serverEnv();
  // Supabase 로그인 토큰(JWT)만 인증에 쓴다. 수신 토큰(vs_…)이나 CRON_SECRET은 Supabase로 보내지 않는다.
  const bearer = req?.headers.get("authorization")?.match(/^Bearer\s+(eyJ[\w-]*\.[\w-]+\.[\w-]+)$/i)?.[1];
  if (bearer) {
    return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서 호출된 경우 쿠키를 쓸 수 없다. 미들웨어가 갱신한다.
        }
      },
    },
  });
}

/** 지금 요청한 사용자 (없으면 null) */
export async function currentUser(req: Request): Promise<User | null> {
  if (isDemo()) {
    const { DEMO_USERS } = await import("../dev/demoDb");
    const store = await cookies();
    const id = store.get(DEMO_COOKIE)?.value;
    const u = DEMO_USERS.find((x) => x.id === id);
    return u ? ({ id: u.id, email: u.email, user_metadata: { name: u.name } } as unknown as User) : null;
  }
  const db = await userClient(req);
  const { data, error } = await db.auth.getUser();
  return error ? null : data.user;
}

let admin: Db | null = null;

export async function adminClient(): Promise<Db> {
  if (isDemo()) {
    const { demoClient } = await import("../dev/demoDb");
    return (await demoClient()) as unknown as Db;
  }
  if (admin) return admin;
  const env = serverEnv();
  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
