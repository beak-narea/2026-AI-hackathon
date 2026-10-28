// 이메일 로그인·초대 링크의 코드를 세션으로 바꾼다
import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { safeNext as sanitizeNext } from "@/lib/client/format";

/** Supabase 오류를 사용자가 할 일로 바꾼다 */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("verifier")) return "로그인 링크는 링크를 요청한 브라우저에서 열어야 합니다. 이 브라우저에서 새 링크를 받으세요.";
  if (m.includes("expired") || m.includes("invalid") || m.includes("already") || m.includes("not found"))
    return "링크가 만료됐거나 이미 쓴 링크입니다. 새 링크를 받으세요.";
  return `로그인하지 못했습니다 (${message.slice(0, 120)}). 새 링크를 받으세요.`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const safeNext = sanitizeNext(url.searchParams.get("next"), "/");
  const fail = (message: string) => {
    const to = new URL("/login", url.origin);
    to.searchParams.set("auth_error", friendly(message));
    return NextResponse.redirect(to);
  };
  // Supabase가 링크 검사에 실패하면 code 없이 error·error_description을 붙여 보낸다
  const supaError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (supaError) return fail(supaError);
  if (!code) {
    // 초대 메일처럼 토큰을 주소의 # 뒤에 붙여 보내는 링크는 서버가 읽을 수 없다.
    // 브라우저는 다시 보낼 때 # 뒤를 그대로 붙이므로, 그 값을 읽는 화면으로 넘긴다.
    const to = new URL("/auth/finish", url.origin);
    to.searchParams.set("next", safeNext);
    return NextResponse.redirect(to);
  }
  const db = await userClient();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
