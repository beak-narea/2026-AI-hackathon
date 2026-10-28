"use client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { DECISION_KO, HypothesisStatus, VerdictBadge } from "@/components/badges";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, Note, Segmented, toast } from "@/components/ui";
import { hypothesisLabel, projectName } from "@/lib/client/format";

type Choice = "continue" | "revise" | "stop" | "more_validation";
interface Rec { verdict: { id: string; hypothesis_id: string; result: string; n: number; successes: number } | null; recommendation: { recommendation: Choice; rationale: string } | null }
interface H { id: string; statement: string; status: string; source_field?: string | null }
interface D { id: string; hypothesis_id: string; verdict_id: string | null; recommendation: Choice; choice: Choice; reason_type: string; note: string; decided_at: string; is_grounded_change: boolean }

const CHOICES: Array<{ value: Choice; label: string; hint: string }> = [
  { value: "continue", label: "계속", hint: "다음 가설로 넘어갑니다. 충족한 가설은 실사용 지표로 다시 잴 수 있습니다." },
  { value: "more_validation", label: "추가 검증", hint: "표본을 늘리거나 다른 방법으로 다시 검증합니다." },
  { value: "revise", label: "수정", hint: "가설이나 사업 모델을 고칩니다." },
  { value: "stop", label: "중단", hint: "프로젝트를 보관함으로 옮깁니다. 근거 있는 중단도 성과입니다." },
];
const WITH_RO: Record<Choice, string> = { continue: "계속으로", more_validation: "추가 검증으로", revise: "수정으로", stop: "중단으로" };
const NEXT: Record<string, (p: string, q?: string) => string> = {
  proposals: (p, q) => `/projects/${p}/proposals${q ? `?${q}` : ""}`, proposal: (p) => `/projects/${p}/proposals`,
  hypotheses: (p) => `/projects/${p}/hypotheses`, archive: () => `/archive`,
};

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const hyps = useApi<{ hypotheses: H[] }>(`/api/projects/${projectId}/hypotheses`);
  const decisions = useApi<{ decisions: D[] }>(`/api/projects/${projectId}/decisions`);
  const [hid, setHid] = useState(params.get("hypothesis") ?? "");
  const verdicts = useApi<{ verdicts: Array<{ id: string; hypothesis_id: string }> }>(`/api/projects/${projectId}/verdicts`);
  // 결정을 기다리는 가설: 검증 중이거나, 가장 최근 판정에 아직 결정이 없는 가설 (충족한 뒤 실사용 지표로 다시 잰 경우 등)
  const decided = new Set((decisions.data?.decisions ?? []).map((d) => d.verdict_id));
  const latestVerdict = new Map<string, string>();
  for (const v of verdicts.data?.verdicts ?? []) if (!latestVerdict.has(v.hypothesis_id)) latestVerdict.set(v.hypothesis_id, v.id);
  const candidates = (hyps.data?.hypotheses ?? []).filter(
    (h) => h.status === "in_progress" || h.status === "needs_recheck" || (latestVerdict.has(h.id) && !decided.has(latestVerdict.get(h.id)!)),
  );
  // 고른 가설을 주소에도 남겨 위쪽 권고(무대)와 본문이 같은 가설을 보게 한다
  const pick = (id: string) => {
    setHid(id);
    router.replace(`/projects/${projectId}/decisions?hypothesis=${id}`, { scroll: false });
  };
  useEffect(() => { if (!hid && candidates[0]) pick(candidates[0].id); }, [hid, candidates]); // eslint-disable-line react-hooks/exhaustive-deps
  const rec = useApi<Rec>(hid ? `/api/projects/${projectId}/hypotheses/${hid}/recommendation` : null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState<"evidence" | "external" | "other">("evidence");
  const [note, setNote] = useState("");
  useEffect(() => { setChoice(rec.data?.recommendation?.recommendation ?? null); }, [rec.data]);
  const record = useAction(async () => {
    const r = await api<{ next_screen?: string; next_query?: string }>(`/api/projects/${projectId}/decisions`, {
      // 권고를 불러오는 중이면 이전 가설의 판정을 보내지 않는다
      body: { hypothesis_id: hid, verdict_id: rec.data?.verdict && rec.data.verdict.hypothesis_id === hid ? rec.data.verdict.id : null, choice, reason_type: reason, note },
    });
    toast(`${WITH_RO[choice!]} 기록했습니다`);
    router.push((NEXT[r.next_screen ?? ""] ?? ((p: string) => `/projects/${p}`))(projectId, r.next_query));
  });
  const statement = (id: string) => { const h = hyps.data?.hypotheses.find((x) => x.id === id); return h ? hypothesisLabel(h) : ""; };
  if (hyps.loading) return <Loading />;

  return (
    <>
      <section className="section">
        <div className="section__head">
          <div>
            <h2>결정 기록</h2>
          </div>
          {candidates.length > 1 ? (
            <select className="select" style={{ width: "auto", maxWidth: 360 }} aria-label="가정 고르기" value={hid} onChange={(e) => pick(e.target.value)}>
              {candidates.map((h) => <option key={h.id} value={h.id}>{hypothesisLabel(h)}</option>)}
            </select>
          ) : null}
        </div>
        {!hid ? (
          <Empty title="결정을 기다리는 가정이 없습니다" />
        ) : !canEdit ? <ReadOnlyHint /> : (
          <div className="panel panel--tilt">
            <h3>{statement(hid)}</h3>
            {rec.data?.verdict ? (
              <p className="small" style={{ marginTop: 0 }}>판정 <VerdictBadge result={rec.data.verdict.result} /> <span className="num">{rec.data.verdict.successes}/{rec.data.verdict.n}</span></p>
            ) : null}
            {rec.data?.recommendation ? (
              <div className="sub" style={{ marginBottom: 16 }}>
                <p style={{ margin: 0 }}><strong>서비스 권고: {DECISION_KO[rec.data.recommendation.recommendation]}</strong></p>
                <p className="small muted" style={{ margin: "4px 0 0" }}>{rec.data.recommendation.rationale}</p>
              </div>
            ) : null}
            <div className="field">
              <span>팀의 결정</span>
              <Segmented label="팀의 결정" value={(choice ?? "") as Choice} onChange={setChoice} options={CHOICES.map((c) => ({ value: c.value, label: c.label }))} />
              <small>{CHOICES.find((c) => c.value === choice)?.hint}</small>
            </div>
            <div className="field">
              <span>결정 사유</span>
              <Segmented label="결정 사유" value={reason} onChange={setReason}
                options={[{ value: "evidence", label: "증거" }, { value: "external", label: "외부 사정" }, { value: "other", label: "기타" }]} />
              <small>자금 사정이나 팀 사정 때문이면 외부 사정을 고릅니다. 증거로 내린 결정만 성과로 셉니다.</small>
            </div>
            <Field label="메모"><textarea className="textarea" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {choice === "stop" ? <Note tone="warn"><p>중단하면 프로젝트가 보관함으로 옮겨집니다. 나중에 되살릴 수 있습니다.</p></Note> : null}
            <ErrorNote error={record.error} />
            <button className="pill pill--ink" disabled={!choice || record.busy || (reason === "evidence" && !rec.data?.verdict)} onClick={() => void record.run()}>
              {choice ? `${WITH_RO[choice]} 기록` : "결정을 고르세요"}
            </button>
          </div>
        )}
      </section>
      <section className="section">
        <div className="section__head"><h2>지난 결정</h2></div>
        {(decisions.data?.decisions ?? []).length === 0 ? <p className="muted">아직 기록이 없습니다.</p> : (
          <div className="rows">
            {decisions.data!.decisions.map((d) => (
              <div key={d.id} className="row">
                <div>
                  <div className="row__title">{statement(d.hypothesis_id)}</div>
                  <div className="row__meta">
                    <span>권고 {DECISION_KO[d.recommendation]}</span><span>결정 {DECISION_KO[d.choice]}</span>
                    <span>{d.reason_type === "evidence" ? "증거" : d.reason_type === "external" ? "외부 사정" : "기타"}</span>
                    <span>{dateKo(d.decided_at)}</span>
                  </div>
                  {d.note ? <div className="row__meta">{d.note}</div> : null}
                </div>
                <div className="row__side">
                  <HypothesisStatus status={hyps.data?.hypotheses.find((h) => h.id === d.hypothesis_id)?.status ?? ""} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function DecisionStage({ projectId, name }: { projectId: string; name: string }) {
  const params = useSearchParams();
  const hid = params.get("hypothesis");
  const rec = useApi<Rec>(hid ? `/api/projects/${projectId}/hypotheses/${hid}/recommendation` : null);
  const r = rec.data?.recommendation;
  return (
    <Stage short crumb={<><b>검증 · 결정</b>{name}</>} seed={8} aside={<span className="stage__note">권고는 서비스, 결정은 팀</span>}>
      <TiltCard kicker="서비스 권고" title={r ? DECISION_KO[r.recommendation] : "계속, 수정, 중단, 추가 검증"} sub={r?.rationale} />
    </Stage>
  );
}

export default function DecisionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <Suspense><DecisionStage projectId={projectId} name={projectName(info?.project.name)} /></Suspense>}>
      <Suspense><Body projectId={projectId} /></Suspense>
    </ProjectShell>
  );
}
