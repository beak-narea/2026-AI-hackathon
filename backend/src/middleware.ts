// Supabase 세션 쿠키 갱신 (만료 직전 토큰을 새로 고친다)
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || process.env.DEMO_MODE === "1") return response;
  // 로그인 쿠키가 없으면 갱신할 것도 없다 (Supabase에 묻지 않는다)
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // 정적 파일과 API는 건너뛴다 (API 라우트는 스스로 로그인을 확인하고 쿠키를 갱신한다. 요청마다 Supabase 왕복이 두 번 생기지 않게)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|svg|webp|woff2?|ico)$).*)"],
};
