"use client";
import { useState } from "react";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, toast } from "@/components/ui";

interface CodingSet { id: string; name: string; code_types: string[]; created_at: string; segments: number }
interface Status { code_type: string; alpha: number | null; n_units: number; required: number; status: "auto" | "review" | "off"; computed_at: string }
const STATUS_KO = { auto: ["자동 적용", "met"], review: ["사람 검토", "on_hold"], off: ["적용 안 함", "not_met"] } as const;

function HumanCoding({ set, done }: { set: CodingSet; done: () => Promise<void> }) {
  const { data, loading, reload } = useApi<{ total: number; done: number; segments: Array<{ id: string; idx: number; text: string }> }>(`/api/admin/coding/${set.id}/next`);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const save = useAction(async () => {
    const labels = Object.entries(picks).map(([segment_id, code_type]) => ({ segment_id, code_type }));
    await api(`/api/admin/coding/${set.id}/labels`, { body: { labels } });
    setPicks({});
    toast(`${labels.length}개 구간을 코딩했습니다`);
    await Promise.all([reload(), done()]);
  });
  if (loading) return <Loading />;
  const segs = data?.segments ?? [];
  return (
    <div className="sub" style={{ marginTop: 12 }}>
      <p className="small" style={{ margin: "0 0 10px" }}>내 코딩 {data?.done}/{data?.total}</p>
      {segs.length === 0 ? <p className="muted">모두 코딩했습니다.</p> : (
        <>
          {segs.map((s) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 200px", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--rule)" }}>
              <span><span className="num muted">{s.idx}.</span> {s.text}</span>
              <select className="select" aria-label={`${s.idx}번 구간 코드`} value={picks[s.id] ?? ""} onChange={(e) => setPicks({ ...picks, [s.id]: e.target.value })}>
                <option value="">고르기</option>
                {[...set.code_types, "없음"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ))}
          <ErrorNote error={save.error} />
          <div className="form-actions"><button className="pill pill--ink" disabled={save.busy || !Object.keys(picks).length} onClick={() => void save.run()}>고른 {Object.keys(picks).length}개 저장</button></div>
        </>
      )}
    </div>
  );
}

export default function Coding() {
  const { data, loading, error, reload } = useApi<{ sets: CodingSet[]; status: Status[] }>("/api/admin/coding");
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [types, setTypes] = useState("언급된 도구, 현재 해결 방법, 비용, 전환 동기");
  const [text, setText] = useState("");
  const create = useAction(async () => {
    const r = await api<{ segments: number }>("/api/admin/coding", { body: { name, code_types: types.split(",").map((t) => t.trim()).filter(Boolean), text } });
    toast(`구간 ${r.segments}개로 세트를 만들었습니다`);
    setName(""); setText("");
    await reload();
  });
  const llm = useAction(async (id: string) => {
    const r = await api<{ labeled: number }>(`/api/admin/coding/${id}/llm`, { method: "POST" });
    toast(`LLM이 ${r.labeled}개 구간을 코딩했습니다`);
    await reload();
  });
  const compute = useAction(async () => {
    await api("/api/admin/coding/compute", { method: "POST" });
    toast("코드 유형별 α를 다시 계산했습니다");
    await reload();
  });
  if (loading) return <Loading lines={5} />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <>
      <section className="section">
        <div className="section__head">
          <h2>코드 유형별 판정</h2>
          <button className="pill" disabled={compute.busy} onClick={() => void compute.run()}>α 다시 계산</button>
        </div>
        <ErrorNote error={compute.error ?? llm.error} />
        {data.status.length === 0 ? <p className="muted">아직 계산한 코드 유형이 없습니다.</p> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>코드 유형</th><th>α</th><th>구간</th><th>판정</th><th>계산일</th></tr></thead>
              <tbody>
                {data.status.map((s) => (
                  <tr key={s.code_type}>
                    <td>{s.code_type}</td><td className="num">{s.alpha === null ? "–" : s.alpha.toFixed(3)}</td>
                    <td className="num">{s.n_units}/{s.required}</td>
                    <td className={STATUS_KO[s.status][1] === "met" ? "met" : STATUS_KO[s.status][1] === "on_hold" ? "hold" : "not_met"}>{STATUS_KO[s.status][0]}{s.n_units < s.required ? " (표본 부족)" : ""}</td>
                    <td>{dateKo(s.computed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="section">
        <div className="section__head"><h2>검증 세트</h2></div>
        {data.sets.length === 0 ? <Empty title="검증 세트가 없습니다">출시 전 내부 검증용 전사본 구간을 넣습니다. 고객 전사본은 매달 무작위로 뽑아 같은 방식으로 점검합니다.</Empty> : (
          <div className="rows">
            {data.sets.map((s) => (
              <div key={s.id}>
                <div className="row">
                  <div>
                    <div className="row__title">{s.name}</div>
                    <div className="row__meta">구간 {s.segments}개 · {s.code_types.join(", ")} · {dateKo(s.created_at)}</div>
                  </div>
                  <div className="row__side">
                    <button className="pill pill--sm" disabled={llm.busy} onClick={() => void llm.run(s.id)}>LLM 코딩</button>
                    <button className="pill pill--sm" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "닫기" : "내가 코딩"}</button>
                  </div>
                </div>
                {open === s.id ? <HumanCoding set={s} done={reload} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="section">
        <div className="section__head"><h2>세트 만들기</h2></div>
        <div className="panel">
          <Field label="이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 내부 검증 세트 1" /></Field>
          <Field label="코드 유형 (쉼표로 구분)"><input className="input" value={types} onChange={(e) => setTypes(e.target.value)} /></Field>
          <Field label="구간" hint="빈 줄로 구간 구분"><textarea className="textarea" style={{ minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <ErrorNote error={create.error} />
          <button className="pill pill--ink" disabled={create.busy || !name || text.length < 5} onClick={() => void create.run()}>만들기</button>
        </div>
      </section>
    </>
  );
}
