import { cookies } from "next/headers";
import { z } from "zod";
import { route, body, ApiError } from "@/lib/api/handler";
import { isDemo } from "@/lib/env";
import { DEMO_COOKIE } from "@/lib/supabase/server";

// 데모 모드 전용 로그인 (운영에서는 404)
export const POST = route(async (ctx) => {
  if (!isDemo()) throw new ApiError(404, "not_found", "없는 주소");
  const { DEMO_USERS } = await import("@/lib/dev/demoDb");
  const { user } = await body(ctx.req, z.object({ user: z.number().int().min(0).max(DEMO_USERS.length - 1).default(0) }));
  const u = DEMO_USERS[user]!;
  const store = await cookies();
  store.set(DEMO_COOKIE, u.id, { httpOnly: true, sameSite: "lax", path: "/" });
  // 프로필이 없으면 만든다 (auth 트리거는 데모 사용자 삽입 때 이미 돌았다)
  await ctx.admin.from("profiles").upsert({ id: u.id, display_name: u.name });
  return { user: { id: u.id, email: u.email, name: u.name } };
}, { auth: false });
