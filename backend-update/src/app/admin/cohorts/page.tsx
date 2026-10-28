"use client";
import { useState } from "react";
import { api, pct, useAction, useApi } from "@/lib/client/api";
import { VerdictBadge } from "@/components/badges";
import { Empty, ErrorNote, Field, Loading, Note, toast } from "@/components/ui";

interface Judged { result: string; k: number; n: number; p_above_target?: number; p_below_min?: number; wilson_low?: number; wilson_high?: number; look?: number; note?: string }
interface Team {
  id: string; team_name: string; project_id: string | null; is_design_partner: boolean; offered_at: string | null; prepaid: boolean | null;
  grounded_change: boolean; received_proposal: boolean; submitted_result: boolean; payment_counted: boolean; paid: boolean;
}
interface Report {
  criteria: { decision: { target: number; min: number; label: string }; payment: { target: number; min: number; label: string } };
  cohorts: Array<{ cohort: { id: string; name: string; started_at: string }; teams: Team[]; cumulative_teams: number; decision: Judged | null; payment: Judged | null; payment_not_counted: number; submission: { k: number; n: number } }>;
  outlook: { decision_at_50pct: { pConclusive: number } | null; payment_at_25pct: { pConclusive: number } | null } | null;
  projects: Array<{ id: string; name: string }>;
}

function Verdict({ j }: { j: Judged | null }) {
  if (!j) return <span className="muted">대상 없음</span>;
  return (
    <span>
      <VerdictBadge result={j.result} /> <span className="num">{j.k}/{j.n}</span>
      {j.wilson_low !== undefined ? <span className="small muted"> (95% 구간 {pct(j.wilson_low)}~{pct(j.wilson_high)}, {j.look}회차)</span> : null}
      {j.note ? <span className="small muted"> {j.note}</span> : null}
    </span>
  );
}

function TeamForm({ cohortId, projects, team, done }: { cohortId: string; projects: Report["projects"]; team?: Team; done: () => Promise<void> }) {
  const [name, setName] = useState(team?.team_name ?? "");
  const [project, setProject] = useState(team?.project_id ?? "");
  const [partner, setPartner] = useState(team?.is_design_partner ?? false);
  const [offered, setOffered] = useState(team?.offered_at ?? "");
  const [prepaid, setPrepaid] = useState(team?.prepaid === null || team?.prepaid === undefined ? "" : team.prepaid ? "yes" : "no");
  const save = useAction(async () => {
    await api(`/api/admin/cohorts/${cohortId}/teams`, {
      body: { id: team?.id, team_name: name, project_id: project || null, is_design_partner: partner, offered_at: offered || null, prepaid: prepaid === "" ? null : prepaid === "yes" },
    });
    if (!team) { setName(""); setProject(""); }
    await done();
  });
  return (
    <div className="sub" style={{ marginTop: 10 }}>
      <div className="grid3">
        <Field label="팀 이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="프로젝트 연결" hint="결정 변화(근거 있는 수정·중단)를 자동으로 셉니다">
          <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">연결 안 함</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="선결제 제안일"><input className="input" type="date" value={offered} onChange={(e) => setOffered(e.target.value)} /></Field>
      </div>
      <div className="grid3">
        <Field label="2주 안 선결제">
          <select className="select" value={prepaid} onChange={(e) => setPrepaid(e.target.value)}>
            <option value="">아직 모름</option><option value="yes">결제함</option><option value="no">결제 안 함</option>
          </select>
        </Field>
        <label className="check" style={{ alignSelf: "center" }}><input type="checkbox" checked={partner} onChange={(e) => setPartner(e.target.checked)} /><span>디자인 파트너</span></label>
        <div className="field"><span>&nbsp;</span><button className="pill pill--ink" disabled={save.busy || !name} onClick={() => void save.run()}>{team ? "저장" : "팀 추가"}</button></div>
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}

export default function Cohorts() {
  const { data, loading, error, reload } = useApi<Report>("/api/admin/cohorts");
  const [name, setName] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [edit, setEdit] = useState<string | null>(null);
  const create = useAction(async () => {
    await api("/api/admin/cohorts", { body: { name, started_at: start } });
    setName("");
    await reload();
  });
  const offer = useAction(async (cohortId: string, date: string) => {
    await api(`/api/admin/cohorts/${cohortId}/offer`, { body: { offered_at: date } });
    toast("기수 전체에 같은 날 제안으로 기록했습니다");
    await reload();
  });
  const remove = useAction(async (id: string) => {
    await api(`/api/admin/teams/${id}`, { method: "DELETE" });
    await reload();
  });
  if (loading) return <Loading lines={6} />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <>
      <Note tone="info">
        <p><strong>결정 변화</strong>: 목표 {pct(data.criteria.decision.target)}, 최소 {pct(data.criteria.decision.min)}. 근거 있는 수정·중단(네 조건)을 한 팀만 셉니다.</p>
        <p><strong>지불</strong>: 목표 {pct(data.criteria.payment.target)}, 최소 {pct(data.criteria.payment.min)}. 모든 팀에 같은 날·같은 가격으로 선결제를 제안하고 2주 안에 결제한 팀만 셉니다.</p>
        <p>기준은 처음 잠근 값을 그대로 쓰고, 판정 보류면 다음 기수를 더해 다시 판정합니다 (최대 4회). 결과 회수율은 성공 기준이 아니라 보조 지표입니다.</p>
      </Note>
      {data.outlook?.decision_at_50pct ? (
        <p className="small muted">지금 팀 수로 결론이 날 확률: 결정 변화(실제 50%일 때) {pct(data.outlook.decision_at_50pct.pConclusive)}, 지불(실제 25%일 때) {pct(data.outlook.payment_at_25pct?.pConclusive)}</p>
      ) : null}
      <ErrorNote error={offer.error ?? remove.error} />
      {data.cohorts.length === 0 ? <Empty title="기수가 없습니다">첫 기수를 만들고 팀을 넣습니다.</Empty> : data.cohorts.map((c) => (
        <section className="section" key={c.cohort.id}>
          <div className="section__head">
            <div>
              <h2>{c.cohort.name}</h2>
              <p>시작 {c.cohort.started_at}, 누적 {c.cumulative_teams}팀</p>
            </div>
            <button className="pill pill--sm" disabled={offer.busy} onClick={() => { const d = window.prompt("선결제 제안일 (YYYY-MM-DD)", new Date().toISOString().slice(0, 10)); if (d) void offer.run(c.cohort.id, d); }}>기수 전체 제안일 기록</button>
          </div>
          <div className="table-wrap">
            <table className="t">
              <tbody>
                <tr><td>결정 변화 (누적)</td><td><Verdict j={c.decision} /></td></tr>
                <tr><td>지불 (누적)</td><td><Verdict j={c.payment} />{c.payment_not_counted ? <span className="small muted"> 제안 전·2주 대기 {c.payment_not_counted}팀 제외</span> : null}</td></tr>
                <tr><td>보조: 결과 제출 비율</td><td className="num">{c.submission.k}/{c.submission.n}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="rows" style={{ marginTop: 14 }}>
            {c.teams.map((t) => (
              <div key={t.id}>
                <div className="row">
                  <div>
                    <div className="row__title">{t.team_name}{t.is_design_partner ? <span className="badge" style={{ marginLeft: 8 }}>디자인 파트너</span> : null}</div>
                    <div className="row__meta">
                      {t.project_id ? "프로젝트 연결됨" : "프로젝트 미연결"}
                      <span className={`badge${t.grounded_change ? " badge--met" : ""}`}>근거 있는 결정 {t.grounded_change ? "있음" : "없음"}</span>
                      <span className={`badge${t.paid ? " badge--met" : t.payment_counted ? " badge--not_met" : ""}`}>{t.paid ? "선결제" : t.payment_counted ? "미결제" : t.offered_at ? "2주 대기" : "제안 전"}</span>
                    </div>
                  </div>
                  <div className="row__side">
                    <button className="pill pill--sm" onClick={() => setEdit(edit === t.id ? null : t.id)}>{edit === t.id ? "닫기" : "고치기"}</button>
                    <button className="pill pill--sm" disabled={remove.busy} onClick={() => { if (window.confirm("이 팀을 뺄까요?")) void remove.run(t.id); }}>빼기</button>
                  </div>
                </div>
                {edit === t.id ? <TeamForm cohortId={c.cohort.id} projects={data.projects} team={t} done={async () => { setEdit(null); await reload(); }} /> : null}
              </div>
            ))}
          </div>
          <TeamForm cohortId={c.cohort.id} projects={data.projects} done={reload} />
        </section>
      ))}
      <section className="section">
        <div className="section__head"><h2>기수 추가</h2></div>
        <div className="panel">
          <div className="grid2">
            <Field label="이름"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2027 봄 1기" /></Field>
            <Field label="시작일"><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          </div>
          <ErrorNote error={create.error} />
          <button className="pill pill--ink" disabled={create.busy || !name} onClick={() => void create.run()}>기수 만들기</button>
        </div>
      </section>
    </>
  );
}
