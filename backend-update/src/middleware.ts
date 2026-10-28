// Supabase 세션 쿠키 갱신 (만료 직전 토큰을 새로 고친다)
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
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
  // 정적 파일, 수신 주소, 헬스체크는 건너뛴다
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/ingest|api/cron|.*\\.(?:png|jpg|svg|webp)$).*)"],
};
