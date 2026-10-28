"use client";
import { useState } from "react";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, toast } from "@/components/ui";

interface Mentor { id: string; name: string; email: string; organization: string; expertise: string[]; fee_krw: number; active: boolean }
interface Req {
  id: string; topic: string; status: string; fee_krw: number; created_at: string;
  projects: { name: string } | null; hypotheses: { statement: string } | null; mentors: { name: string } | null;
}
const STATUS_KO: Record<string, string> = { requested: "요청함", matched: "배정됨", done: "끝남", cancelled: "취소" };

export default function Mentors() {
  const { data, loading, error, reload } = useApi<{ mentors: Mentor[]; requests: Req[] }>("/api/admin/mentors");
  const [m, setM] = useState({ name: "", email: "", organization: "", expertise: "", fee: "100000" });
  const [pick, setPick] = useState<Record<string, string>>({});
  const add = useAction(async () => {
    await api("/api/admin/mentors", {
      body: { name: m.name, email: m.email, organization: m.organization, expertise: m.expertise.split(",").map((x) => x.trim()).filter(Boolean), fee_krw: Number(m.fee) || 0 },
    });
    setM({ name: "", email: "", organization: "", expertise: "", fee: "100000" });
    await reload();
  });
  const toggle = useAction(async (x: Mentor) => {
    await api("/api/admin/mentors", { body: { id: x.id, name: x.name, email: x.email, active: !x.active } });
    await reload();
  });
  const match = useAction(async (reqId: string) => {
    await api(`/api/admin/mentor-requests/${reqId}`, { body: { mentor_id: pick[reqId] } });
    toast("배정하고 외부 평가자로 초대했습니다");
    await reload();
  });
  const close = useAction(async (reqId: string, status: "done" | "cancelled") => {
    await api(`/api/admin/mentor-requests/${reqId}`, { body: { status } });
    await reload();
  });
  if (loading) return <Loading lines={5} />;
  if (error || !data) return <ErrorNote error={error} />;
  const active = data.mentors.filter((x) => x.active);
  return (
    <>
      <ErrorNote error={match.error ?? close.error ?? toggle.error} />
      <section className="section">
        <div className="section__head"><h2>요청</h2></div>
        {data.requests.length === 0 ? <Empty title="요청이 없습니다" /> : (
          <div className="rows">
            {data.requests.map((r) => (
              <div className="row" key={r.id}>
                <div>
                  <div className="row__title">{r.projects?.name ?? "프로젝트"}: {r.topic || r.hypotheses?.statement || "외부 평가자"}</div>
                  <div className="row__meta">{dateKo(r.created_at)} · {STATUS_KO[r.status]}{r.mentors ? ` · ${r.mentors.name}` : ""}{r.fee_krw ? ` · 수당 ${r.fee_krw.toLocaleString("ko-KR")}원` : ""}</div>
                </div>
                <div className="row__side">
                  {r.status === "requested" ? (
                    <>
                      <select className="select" style={{ width: "auto" }} aria-label="멘토" value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                        <option value="">멘토 고르기</option>
                        {active.map((x) => <option key={x.id} value={x.id}>{x.name}{x.organization ? ` (${x.organization})` : ""}</option>)}
                      </select>
                      <button className="pill pill--sm pill--go" disabled={match.busy || !pick[r.id]} onClick={() => void match.run(r.id)}>배정</button>
                      <button className="pill pill--sm" disabled={close.busy} onClick={() => void close.run(r.id, "cancelled")}>취소</button>
                    </>
                  ) : r.status === "matched" ? (
                    <button className="pill pill--sm" disabled={close.busy} onClick={() => void close.run(r.id, "done")}>끝남으로</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="section">
        <div className="section__head"><h2>제휴 멘토 <span className="num">{active.length}</span></h2></div>
        <div className="rows" style={{ marginBottom: 16 }}>
          {data.mentors.map((x) => (
            <div className="row" key={x.id}>
              <div>
                <div className="row__title">{x.name} {x.organization ? <span className="muted">· {x.organization}</span> : null}</div>
                <div className="row__meta">{x.email} · {x.expertise.join(", ") || "분야 미입력"} · 수당 {x.fee_krw.toLocaleString("ko-KR")}원</div>
              </div>
              <div className="row__side">
                <span className={`badge${x.active ? " badge--met" : ""}`}>{x.active ? "활동" : "쉬는 중"}</span>
                <button className="pill pill--sm" disabled={toggle.busy} onClick={() => void toggle.run(x)}>{x.active ? "쉬게 하기" : "다시 활동"}</button>
              </div>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>멘토 등록</h3>
          <div className="grid2">
            <Field label="이름"><input className="input" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></Field>
            <Field label="이메일"><input className="input" type="email" value={m.email} onChange={(e) => setM({ ...m, email: e.target.value })} /></Field>
            <Field label="소속"><input className="input" value={m.organization} onChange={(e) => setM({ ...m, organization: e.target.value })} /></Field>
            <Field label="분야 (쉼표로 구분)"><input className="input" value={m.expertise} onChange={(e) => setM({ ...m, expertise: e.target.value })} /></Field>
            <Field label="평가 수당 (원)"><input className="input num" inputMode="numeric" value={m.fee} onChange={(e) => setM({ ...m, fee: e.target.value })} /></Field>
          </div>
          <ErrorNote error={add.error} />
          <button className="pill pill--ink" disabled={add.busy || !m.name || !m.email} onClick={() => void add.run()}>등록</button>
        </div>
      </section>
    </>
  );
}
