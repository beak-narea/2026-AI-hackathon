// 이메일 로그인·초대 링크의 코드를 세션으로 바꾼다
import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { safeNext as sanitizeNext } from "@/lib/client/format";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const safeNext = sanitizeNext(url.searchParams.get("next"), "/");
  if (code) {
    const db = await userClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
