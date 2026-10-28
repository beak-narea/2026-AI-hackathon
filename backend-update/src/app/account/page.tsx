"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Stage, TiltCard } from "@/components/Stage";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Empty, ErrorNote, Field, Loading, Note, toast } from "@/components/ui";

interface Account {
  email: string | null;
  profile: { display_name: string | null; email_notifications: boolean; terms_version: string | null; terms_accepted_at: string | null; data_use_accepted_at: string | null; created_at: string } | null;
  owned_projects: Array<{ id: string; name: string; status: string }>;
}

export default function AccountPage() {
  const { session, refresh } = useSession();
  const { data, loading, error, reload } = useApi<Account>(session?.user ? "/api/account" : null);
  const [name, setName] = useState("");
  const [mail, setMail] = useState(true);
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    if (data?.profile) {
      setName(data.profile.display_name ?? "");
      setMail(data.profile.email_notifications);
    }
  }, [data]);
  const save = useAction(async () => {
    await api("/api/account", { method: "PATCH", body: { display_name: name || undefined, email_notifications: mail } });
    toast("저장했습니다");
    await Promise.all([reload(), refresh()]);
  });
  const remove = useAction(async () => {
    await api("/api/account", { method: "DELETE", body: { confirm } });
    window.location.href = "/";
  });
  return (
    <>
      <Stage short crumb={<b>내 계정</b>}>
        <TiltCard title={data?.profile?.display_name || data?.email || "내 계정"} sub="이름과 알림을 정하고, 내 기록을 내려받거나 계정을 지웁니다." />
      </Stage>
      <div className="work work--wide">
        <main id="main" style={{ maxWidth: 820 }}>
          <ErrorNote error={error} />
          {!session?.user ? (
            <Empty title="로그인이 필요합니다" action={<Link className="pill pill--ink" href="/login?next=/account">로그인</Link>} />
          ) : loading || !data ? <Loading /> : (
            <>
              <section className="section">
                <div className="section__head"><h2>기본 정보</h2></div>
                <div className="panel">
                  <dl className="kv" style={{ marginBottom: 14 }}>
                    <dt>이메일</dt><dd>{data.email}</dd>
                    <dt>가입</dt><dd>{dateKo(data.profile?.created_at)}</dd>
                    <dt>약관 동의</dt><dd>{data.profile?.terms_version ? `${data.profile.terms_version} 판 (${dateKo(data.profile.terms_accepted_at)})` : "동의 전"}</dd>
                    <dt>데이터 활용 동의</dt><dd>{data.profile?.data_use_accepted_at ? dateKo(data.profile.data_use_accepted_at) : "동의하지 않음"}</dd>
                  </dl>
                  <Field label="이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                  <label className="check">
                    <input type="checkbox" checked={mail} onChange={(e) => setMail(e.target.checked)} />
                    <span>알림을 메일로도 받기 (미달 판정, 점검일, 외부 평가자 연결)</span>
                  </label>
                  <ErrorNote error={save.error} />
                  <button className="pill pill--ink" disabled={save.busy} onClick={() => void save.run()}>저장</button>
                </div>
              </section>
              <section className="section">
                <div className="section__head"><div><h2>내 기록 내려받기</h2><p>내가 만든 프로젝트의 사업 모델, 가설, 기획서, 증거, 판정, 결정을 JSON 파일로 받습니다. 가명과 원래 이름을 잇는 표는 넣지 않습니다.</p></div></div>
                <a className="pill" href="/api/account/export">JSON 내려받기</a>
              </section>
              <section className="section">
                <div className="section__head"><div><h2>계정 지우기</h2><p>내가 만든 프로젝트 {data.owned_projects.length}개와 그 기록, 원자료가 모두 지워집니다. 되돌릴 수 없습니다.</p></div></div>
                <div className="sub">
                  <Note tone="bad"><p>다른 팀원이 함께 쓰는 프로젝트도 내가 소유자면 지워집니다. 필요하면 먼저 기록을 내려받으세요.</p></Note>
                  <Field label="확인을 위해 '계정 삭제'라고 입력"><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
                  <ErrorNote error={remove.error} />
                  <button className="pill" disabled={remove.busy || confirm !== "계정 삭제"} onClick={() => void remove.run()}>계정과 기록 모두 지우기</button>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
}
