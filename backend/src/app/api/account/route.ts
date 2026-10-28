import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { deleteAccount, getAccount, updateAccount } from "@/lib/services/account";
import { DEMO_COOKIE } from "@/lib/supabase/server";
import { isDemo } from "@/lib/env";
import { NextResponse } from "next/server";

export const GET = route(async (ctx) => getAccount(ctx.admin, ctx.user.id, ctx.user.email ?? null));

export const PATCH = route(async (ctx) => {
  const input = await body(ctx.req, z.object({ display_name: z.string().min(1).max(60).optional(), email_notifications: z.boolean().optional() }));
  return updateAccount(ctx.admin, ctx.user.id, input);
});

// 계정 삭제: { confirm: "계정 삭제" }
export const DELETE = route(async (ctx) => {
  const input = await body(ctx.req, z.object({ confirm: z.string() }));
  const result = await deleteAccount(ctx.admin, ctx.user.id, input.confirm);
  const res = NextResponse.json(result);
  if (isDemo()) res.cookies.delete(DEMO_COOKIE);
  return res;
});
