"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/client/format";
import { Stage, TiltCard } from "@/components/Stage";
import { useSession } from "@/components/session";
import { api, useAction } from "@/lib/client/api";
import { ErrorNote, Field, Note } from "@/components/ui";

function LoginInner() {
  const { session, refresh } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [dataUse, setDataUse] = useState(false);

  const demo = useAction(async (user: number) => {
    await api("/api/dev/login", { body: { user } });
    await refresh();
  });
  const authError = params.get("auth_error");
  const magic = useAction(async () => {
    if (!session?.supabase) throw new Error("서버 설정을 불러오지 못해 로그인 링크를 보낼 수 없습니다. 잠시 뒤 다시 시도하고, 계속되면 운영자에게 알려 주세요.");
    const { createBrowserClient } = await import("@supabase/ssr");
    const sb = createBrowserClient(session.supabase.url, session.supabase.anon_key);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(`/login?next=${encodeURIComponent(next)}`)}` },
    });
    if (error) throw new Error(error.message);
    setSent(true);
  });
  const accept = useAction(async () => {
    await api("/api/auth/terms", { body: { terms: true, data_use: dataUse, version: session!.terms.current_version } });
    await refresh();
    router.push(next);
  });

  const step = !session ? "loading" : !session.user ? "signin" : !session.terms.accepted ? "terms" : "done";
  useEffect(() => {
    if (step === "done") router.replace(next);
  }, [step, next, router]);

  return (
    <>
      <Stage short crumb={<b>로그인</b>}>
        <TiltCard
          title={step === "terms" ? "약관 확인" : "검증실에 들어가기"}
          sub={step === "terms" ? "프로젝트를 만들기 전에 한 번만 확인합니다." : "이메일로 받은 링크를 누르면 바로 들어옵니다. 비밀번호는 없습니다."}
        />
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 560 }}>
          {step === "signin" && session?.mode === "demo" ? (
            <section className="section">
              <Note tone="info">
                <p><strong>로컬 데모 모드입니다.</strong> 데이터는 서버를 다시 켜면 사라집니다.</p>
              </Note>
              <ErrorNote error={demo.error} />
              <div className="form-actions">
                <button className="pill pill--ink" disabled={demo.busy} onClick={() => void demo.run(0)}>데모 사용자로 들어가기</button>
                <button className="pill pill--quiet" disabled={demo.busy} onClick={() => void demo.run(1)}>데모 멘토로 들어가기</button>
              </div>
              <p className="small muted">데모 멘토는 외부 평가자 초대를 시험할 때 씁니다.</p>
            </section>
          ) : null}

          {step === "signin" && session?.mode === "supabase" ? (
            <section className="section">
              {authError && !sent ? <Note tone="bad"><p>{authError}</p></Note> : null}
              {session?.unavailable ? <Note tone="bad"><p>서버에 연결하지 못했습니다. 잠시 뒤 새로고침하세요. 계속되면 서버 설정(npm run doctor)을 확인합니다.</p></Note> : null}
              {sent ? (
                <Note tone="good"><p><strong>{email}</strong>로 로그인 링크를 보냈습니다. 메일함에서 링크를 누르세요.</p></Note>
              ) : (
                <form className="panel" onSubmit={(e) => { e.preventDefault(); void magic.run(); }}>
                  <Field label="이메일">
                    <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                  <ErrorNote error={magic.error} />
                  <button className="pill pill--ink" disabled={magic.busy}>로그인 링크 받기</button>
                </form>
              )}
            </section>
          ) : null}

          {step === "terms" ? (
            <section className="section panel panel--tilt">
              <label className="check">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span><strong>이용약관에 동의합니다 (필수).</strong> 올린 원자료의 소유권은 팀에 남습니다. 서비스는 그 팀을 위한 분석에만 씁니다.</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={dataUse} onChange={(e) => setDataUse(e.target.checked)} />
                <span><strong>비식별 데이터 활용에 동의합니다 (선택).</strong> 이름, 연락처, 회사명을 가명으로 바꾼 뒤 10개 팀 이상이 묶인 집계 통계와 서비스 개선에만 씁니다.</span>
              </label>
              <p className="small muted">약관 버전 {session?.terms.current_version}. <a href="/terms" target="_blank" rel="noreferrer">이용약관</a>, <a href="/privacy" target="_blank" rel="noreferrer">개인정보 처리방침</a> 전문 보기</p>
              <ErrorNote error={accept.error} />
              <button className="pill pill--ink" disabled={!terms || accept.busy} onClick={() => void accept.run()}>동의하고 계속</button>
            </section>
          ) : null}
        </main>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
