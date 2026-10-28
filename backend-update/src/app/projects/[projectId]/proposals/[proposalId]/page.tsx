"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { EvidenceLadder, ProposalStatus, VerdictBadge } from "@/components/badges";
import { api, dateKo, pct, useAction, useApi, emitChange, useOnChange } from "@/lib/client/api";
import { ErrorNote, Field, Loading, Note, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";
import { DecisionTable, type TableRow } from "@/components/DecisionTable";

interface Detail {
  proposal: {
    id: string; method: string; method_key: string; status: string; look_number: number; root_proposal_id: string | null;
    evidence_level_expected: string; guide_steps: string[]; prerequisites: string[]; mvp_scope: string; recruitment: string; script: string;
    operating_rules: string[]; target_value: number; min_value: number; locked_at: string | null; expected_rate: number | null;
    sample_size: number | null; decision_table: TableRow[]; conclusion_probability: number | null; expected_weeks: number | null;
  };
  hypothesis: { id: string; statement: string };
  project: { id: string; name: string; is_example: boolean };
  evidence: Array<{ id: string; responses: number; successes: number; evidence_level: string; quality_flags: string[] }>;
  verdicts: Array<{ id: string; result: string; n: number; successes: number }>;
}

function LockForm({ projectId, d, reload }: { projectId: string; d: Detail; reload: () => Promise<void> }) {
  const p = d.proposal;
  const [target, setTarget] = useState(String(Math.round(p.target_value * 100)));
  const [min, setMin] = useState(String(Math.round(p.min_value * 100)));
  const [expected, setExpected] = useState(String(Math.round((p.expected_rate ?? p.target_value) * 100)));
  const [cluster, setCluster] = useState("");
  const [icc, setIcc] = useState("");
  const lock = useAction(async () => {
    await api(`/api/projects/${projectId}/proposals/${p.id}/lock`, {
      body: {
        target_value: Number(target) / 100, min_value: Number(min) / 100, expected_rate: Number(expected) / 100,
        cluster_size: cluster ? Number(cluster) : null, icc: icc ? Number(icc) : null,
      },
    });
    toast("기준을 잠갔습니다. 이제 기획서를 팀에 전달하세요.");
    await reload();
  });
  return (
    <div className="panel">
      <h3>기준 잠그기</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        목표값은 사업 계획이 성립하는 값, 최소 허용치는 그보다 낮으면 사업 모델을 바꿔야 하는 값입니다. 결과를 보기 전에 잠그고, 잠근 뒤에는 바꿀 수 없습니다.
      </p>
      <div className="grid3">
        <Field label="목표값 (%)"><input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="최소 허용치 (%)"><input className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <Field label="예상하는 실제 값 (%)" hint="필요 표본 수 계산에 씁니다"><input className="input" inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
      </div>
      <details>
        <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>같은 회사에서 여러 명을 만나나요?</summary>
        <div className="grid2" style={{ marginTop: 10 }}>
          <Field label="회사당 평균 인원"><input className="input" inputMode="decimal" value={cluster} onChange={(e) => setCluster(e.target.value)} /></Field>
          <Field label="집단 내 상관 (모르면 비워 두세요)" hint="비워 두면 0.2로 계산합니다"><input className="input" inputMode="decimal" value={icc} onChange={(e) => setIcc(e.target.value)} /></Field>
        </div>
      </details>
      <ErrorNote error={lock.error} />
      <button className="pill pill--ink" disabled={lock.busy} onClick={() => void lock.run()}>이 기준으로 잠그기</button>
    </div>
  );
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function GuideEditor({ projectId, d, done }: { projectId: string; d: Detail; done: () => Promise<void> }) {
  const p = d.proposal;
  const [f, setF] = useState({
    method: p.method,
    steps: p.guide_steps.join("\n"),
    prereq: p.prerequisites.join("\n"),
    mvp: p.mvp_scope,
    recruitment: p.recruitment,
    script: p.script,
    rules: p.operating_rules.join("\n"),
    weeks: String(p.expected_weeks ?? 2),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useAction(async () => {
    await api(`/api/projects/${projectId}/proposals/${p.id}`, {
      method: "PATCH",
      body: {
        method: f.method, guide_steps: lines(f.steps), prerequisites: lines(f.prereq), mvp_scope: f.mvp, recruitment: f.recruitment,
        script: f.script, operating_rules: lines(f.rules), expected_weeks: Number(f.weeks) || 2,
      },
    });
    toast("실행 가이드를 고쳤습니다. PDF에도 반영됩니다.");
    await done();
  });
  return (
    <div className="panel">
      <h3>실행 가이드 고치기</h3>
      <p className="small muted" style={{ marginTop: 0 }}>문구만 고칩니다. 목표값·최소 허용치·표본 수는 잠금 화면에서만 정합니다. 줄마다 한 항목입니다.</p>
      <Field label="방법 이름"><input className="input" value={f.method} onChange={set("method")} /></Field>
      <Field label="단계"><textarea className="textarea" value={f.steps} onChange={set("steps")} /></Field>
      <div className="grid2">
        <Field label="준비물"><textarea className="textarea" style={{ minHeight: 80 }} value={f.prereq} onChange={set("prereq")} /></Field>
        <Field label="운영 수칙"><textarea className="textarea" style={{ minHeight: 80 }} value={f.rules} onChange={set("rules")} /></Field>
      </div>
      <Field label="검증용 MVP 범위"><textarea className="textarea" style={{ minHeight: 70 }} value={f.mvp} onChange={set("mvp")} /></Field>
      <Field label="대상 모집"><textarea className="textarea" style={{ minHeight: 70 }} value={f.recruitment} onChange={set("recruitment")} /></Field>
      <Field label="스크립트와 질문지"><textarea className="textarea" value={f.script} onChange={set("script")} /></Field>
      <Field label="예상 기간 (주)"><input className="input" inputMode="decimal" style={{ maxWidth: 120 }} value={f.weeks} onChange={set("weeks")} /></Field>
      <ErrorNote error={save.error} />
      <div className="form-actions">
        <button className="pill pill--ink" disabled={save.busy} onClick={() => void save.run()}>저장</button>
        <button className="pill pill--quiet" onClick={() => void done()}>취소</button>
      </div>
    </div>
  );
}

interface Pitch {
  id: string; created_at: string;
  content: {
    headline: string; one_liner: string; problem_hook: string; offer: string; demo_outline: string[];
    landing_copy: { hero: string; subcopy: string; cta: string };
    objection_handling: Array<{ objection: string; response: string }>; honesty_notes: string[];
  };
}

function PitchPanel({ projectId, proposalId }: { projectId: string; proposalId: string }) {
  const { canEdit } = useProject();
  const { data, reload } = useApi<{ pitches: Pitch[] }>(`/api/projects/${projectId}/proposals/${proposalId}/pitch`);
  const make = useAction(async () => {
    await api(`/api/projects/${projectId}/proposals/${proposalId}/pitch`, { method: "POST" });
    await reload();
  });
  const latest = data?.pitches[0];
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>판매 테스트용 피치·데모 초안</h2>
          <p>초안만 드립니다. 실제 피치·데모 제작과 실행은 팀이 합니다. 효과나 숫자를 지어내지 않고, 아직 없는 기능은 &ldquo;준비 중&rdquo;으로 씁니다.</p>
        </div>
        {canEdit ? <button className="pill" disabled={make.busy} onClick={() => void make.run()}>{make.busy ? "쓰는 중" : latest ? "다시 쓰기" : "초안 받기"}</button> : null}
      </div>
      <ErrorNote error={make.error} />
      {latest ? (
        <div className="grid2">
          <div className="panel panel--light">
            <p className="small muted" style={{ margin: "0 0 4px" }}>{dateKo(latest.created_at)} 초안</p>
            <h3>{latest.content.headline}</h3>
            <p style={{ margin: "0 0 10px" }}>{latest.content.one_liner}</p>
            <dl className="kv">
              <dt>첫 질문</dt><dd>{latest.content.problem_hook}</dd>
              <dt>요청할 행동</dt><dd>{latest.content.offer}</dd>
            </dl>
            <h3 style={{ marginTop: 14 }}>데모 순서</h3>
            <ol style={{ margin: 0, paddingLeft: 20 }}>{latest.content.demo_outline.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </div>
          <div className="panel panel--light">
            <h3>랜딩 페이지 문구</h3>
            <dl className="kv">
              <dt>제목</dt><dd>{latest.content.landing_copy.hero}</dd>
              <dt>설명</dt><dd>{latest.content.landing_copy.subcopy}</dd>
              <dt>버튼</dt><dd>{latest.content.landing_copy.cta}</dd>
            </dl>
            <h3 style={{ marginTop: 14 }}>예상 반론</h3>
            {latest.content.objection_handling.map((o, i) => <p key={i} className="small" style={{ margin: "0 0 6px" }}><strong>{o.objection}</strong> {o.response}</p>)}
            <h3 style={{ marginTop: 14 }}>지켜야 할 것</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{latest.content.honesty_notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      ) : <p className="muted">아직 초안이 없습니다.</p>}
    </section>
  );
}

function Body({ projectId, proposalId }: { projectId: string; proposalId: string }) {
  const { canEdit } = useProject();
  const { data, loading, error, reload: reloadOwn } = useApi<Detail>(`/api/projects/${projectId}/proposals/${proposalId}`);
  const reload = useCallback(async () => {
    await reloadOwn();
    emitChange("proposal");
  }, [reloadOwn]);
  const [editGuide, setEditGuide] = useState(false);
  if (loading) return <Loading lines={6} />;
  if (error || !data) return <ErrorNote error={error} />;
  const p = data.proposal;
  const v = data.verdicts[0];
  return (
    <>
      <section className="section">
        <div className="section__head">
          <div>
            <h2>{p.method}</h2>
            <p>{p.look_number > 1 ? `재판정 ${p.look_number}회차, ` : ""}{p.locked_at ? `기준 잠금 ${dateKo(p.locked_at)}` : "기준 잠금 전"}, 예상 기간 {p.expected_weeks ?? 2}주</p>
          </div>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <ProposalStatus status={p.status} />
            <a className="pill" href={`/api/projects/${projectId}/proposals/${p.id}/pdf`}>PDF 내려받기</a>
          </div>
        </div>
        {v ? (
          <Note tone={v.result === "met" ? "good" : v.result === "not_met" ? "bad" : "warn"}>
            <p>판정: <VerdictBadge result={v.result} /> <span className="num">{v.successes}/{v.n}</span>. <Link href={`/projects/${projectId}/verdicts?proposal=${p.id}`}>판정 자세히 보기</Link></p>
          </Note>
        ) : p.locked_at && canEdit ? (
          <Note tone="info"><p>팀이 실험을 마치면 <Link href={`/projects/${projectId}/results?proposal=${p.id}`}>결과 제출 폼</Link>으로 결과를 보냅니다.</p></Note>
        ) : null}
        {!p.locked_at && canEdit ? <LockForm projectId={projectId} d={data} reload={reload} /> : null}
      </section>

      <section className="section">
        <div className="section__head">
          <div>
            <h2>몇 명이 나오면 무엇을 하나</h2>
            <p>
              필요 표본 <span className="num">{p.sample_size ?? "–"}</span>명. 예상 실제 값 {pct(p.expected_rate)}에서 결론이 나올 확률 {pct(p.conclusion_probability)}.
            </p>
          </div>
        </div>
        <DecisionTable rows={p.decision_table} highlight={p.sample_size} />
        <p className="small muted">실제 비율이 목표값을 넘을 확률이 80% 이상이면 충족, 최소 허용치에 못 미칠 확률이 80% 이상이면 미달, 둘 다 아니면 판정 보류입니다.</p>
      </section>

      <section className="section">
        <div className="section__head">
          <h2>실행 가이드</h2>
          {canEdit && !editGuide ? <button className="pill pill--sm" onClick={() => setEditGuide(true)}>문구 고치기</button> : null}
        </div>
        {editGuide ? <GuideEditor projectId={projectId} d={data} done={async () => { setEditGuide(false); await reload(); }} /> : null}
        <div className="grid2" hidden={editGuide}>
          <div className="panel panel--soft">
            <h3>단계</h3>
            <ol style={{ margin: 0, paddingLeft: 20 }}>{p.guide_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
          <div className="panel panel--soft">
            <h3>준비물과 모집</h3>
            <p style={{ margin: "0 0 8px" }}>{p.prerequisites.length ? p.prerequisites.join(", ") : "따로 없음"}</p>
            <p className="small muted" style={{ margin: 0 }}>모집: {p.recruitment}</p>
          </div>
          <div className="panel panel--soft">
            <h3>검증용 MVP 범위</h3>
            <p style={{ margin: 0 }}>{p.mvp_scope}</p>
          </div>
          <div className="panel panel--soft">
            <h3>운영 수칙</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{p.operating_rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        </div>
        <div className="panel panel--soft" style={{ marginTop: 12 }} hidden={editGuide}>
          <h3>스크립트와 질문지</h3>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{p.script}</p>
        </div>
      </section>
      <PitchPanel projectId={projectId} proposalId={p.id} />
      <ReadOnlyHint />
    </>
  );
}

function DetailStage({ projectId, proposalId, name }: { projectId: string; proposalId: string; name: string }) {
  const { data, reload } = useApi<Detail>(`/api/projects/${projectId}/proposals/${proposalId}`);
  useOnChange("proposal", reload);
  const p = data?.proposal;
  return (
    <Stage crumb={<><b>검증 제안</b><Link href={`/projects/${projectId}/proposals`}>{name}</Link></>} seed={5}
      actions={p ? <a className="pill pill--go" href={`/api/projects/${projectId}/proposals/${p.id}/pdf`}>기획서 PDF</a> : null}
      aside={p ? <span className="stage__note"><EvidenceLadder level={p.evidence_level_expected} onStage /></span> : null}>
      <TiltCard kicker={p?.method} title={data?.hypothesis.statement ?? " "}>
        <Ring value={p?.target_value ?? null} label="목표값" tone="teal" />
        <Ring value={p?.min_value ?? null} label="최소 허용치" tone="coral" />
        <Ring value={p?.conclusion_probability ?? null} label="결론이 나올 확률" tone="cyan" />
        <Ring value={p?.sample_size ? 1 : 0} display={p?.sample_size ? String(p.sample_size) : "–"} unit="명" label="필요 표본" tone="yellow" />
      </TiltCard>
    </Stage>
  );
}

export default function ProposalPage() {
  const { projectId, proposalId } = useParams<{ projectId: string; proposalId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <DetailStage projectId={projectId} proposalId={proposalId} name={projectName(info?.project.name)} />}>
      <Body projectId={projectId} proposalId={proposalId} />
    </ProjectShell>
  );
}
