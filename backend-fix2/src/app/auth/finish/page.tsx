"use client";
// 초대 메일 링크처럼 토큰이 주소의 # 뒤에 오는 로그인을 마무리한다
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeNext } from "@/lib/client/format";
import { useSession } from "@/components/session";
import { Stage, TiltCard } from "@/components/Stage";
import { Loading, Note } from "@/components/ui";

function FinishInner() {
  const { session, refresh } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fail = hash.get("error_description") ?? hash.get("error");
    if (fail) {
      setError(/expired|invalid/i.test(fail) ? "링크가 만료됐거나 이미 쓴 링크입니다. 로그인 화면에서 새 링크를 받으세요." : `로그인하지 못했습니다: ${fail}`);
      return;
    }
    const access = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!access || !refreshToken || !session.supabase) {
      // 이미 로그인한 상태로 다시 연 경우 등
      router.replace(session.user ? next : `/login?next=${encodeURIComponent(next)}`);
      return;
    }
    void (async () => {
      const { createBrowserClient } = await import("@supabase/ssr");
      const sb = createBrowserClient(session.supabase!.url, session.supabase!.anon_key);
      const { error: e } = await sb.auth.setSession({ access_token: access, refresh_token: refreshToken });
      if (e) {
        setError(`로그인하지 못했습니다: ${e.message}`);
        return;
      }
      // 주소창에 토큰이 남지 않게 지운다
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      await refresh();
      // 약관 확인을 거쳐 원래 가려던 곳으로
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    })();
    // session을 처음 받았을 때 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session === null]);

  return (
    <>
      <Stage short crumb={<b>로그인</b>}>
        <TiltCard title="로그인하는 중" sub="잠시만 기다리세요." />
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 560 }}>
          <section className="section">
            {error ? (
              <Note tone="bad">
                <p>{error}</p>
                <p><Link href={`/login?next=${encodeURIComponent(next)}`}>로그인 화면으로</Link></p>
              </Note>
            ) : (
              <Loading lines={2} />
            )}
          </section>
        </main>
      </div>
    </>
  );
}

export default function AuthFinishPage() {
  return (
    <Suspense>
      <FinishInner />
    </Suspense>
  );
}
