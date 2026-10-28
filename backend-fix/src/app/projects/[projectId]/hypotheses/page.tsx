"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { CriticalityTag, EvidenceLadder, HypothesisStatus, TYPE_KO } from "@/components/badges";
import { api, emitChange, pct, useAction, useApi, useOnChange } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Empty, ErrorNote, Field, Loading, Note, Segmented, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";
import { EVIDENCE_LEVELS } from "@/lib/domain/rules";

type Level = "critical" | "major" | "minor";
interface Rating { rater_name: string; rater_type: "team" | "external" | "llm"; level: Level; note: string; needs_review: boolean; rater_user_id: string | null }
interface H {
  id: string; statement: string; type: string; criticality: Level | null; critical_candidate: boolean; evidence_level: string;
  status: string; rank: number | null; premortem_reason: string | null;
  diagnosis_id: string | null; diagnosis_axis: "feasibility" | "demand" | "buyer_demand" | null;
  ratings: Rating[];
  consensus: { consensus: Level | null; needsDiscussion: boolean; needsExternalRater: boolean; llmFlagReview: boolean; humanRaterCount: number };
  outside_view: { fail_rate: number; judged: number; companies: number } | null;
}

const LEVELS: Array<{ value: Level; label: string; anchor: string }> = [
  { value: "critical", label: "치명", anchor: "틀리면 아이디어 전체를 접어야 한다" },
  { value: "major", label: "중대", anchor: "틀리면 고객, 가격, 채널, 기술 중 한 축을 바꿔야 한다" },
  { value: "minor", label: "경미", anchor: "틀려도 기능이나 문구 수정으로 대응할 수 있다" },
];

interface Diag { id: string; tasks: { name: string } | null }
const AXIS_KO = { feasibility: "기술 가능성 축", demand: "수요 축 (업무를 하는 사람)", buyer_demand: "수요 축 (돈을 내는 사람)" } as const;

function EditPanel({ projectId, h, diags, reload }: { projectId: string; h: H; diags: Diag[]; reload: () => Promise<void> }) {
  const [statement, setStatement] = useState(h.statement);
  const [type, setType] = useState(h.type);
  const [diag, setDiag] = useState(h.diagnosis_id ?? "");
  const [axis, setAxis] = useState<string>(h.diagnosis_axis ?? "");
  const save = useAction(async () => {
    await api(`/api/projects/${projectId}/hypotheses/${h.id}`, {
      method: "PATCH",
      body: { statement, type, diagnosis_id: diag || null, diagnosis_axis: diag && axis ? axis : null },
    });
    toast("가설을 고쳤습니다");
    await reload();
  });
  const remove = useAction(async () => {
    await api(`/api/projects/${projectId}/hypotheses/${h.id}`, { method: "DELETE" });
    toast("가설을 지웠습니다");
    await reload();
  });
  return (
    <div className="panel panel--light" style={{ margin: "10px 0" }}>
      <h3>가설 고치기</h3>
      <Field label="문장"><input className="input" value={statement} onChange={(e) => setStatement(e.target.value)} /></Field>
      <Field label="유형">
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      {diags.length ? (
        <div className="grid2">
          <Field label="진단 업무에 연결 (선택)" hint="연결하면 이 가설의 판정이 그 업무의 4구역 축을 채웁니다">
            <select className="select" value={diag} onChange={(e) => setDiag(e.target.value)}>
              <option value="">연결 안 함</option>
              {diags.map((d) => <option key={d.id} value={d.id}>{d.tasks?.name ?? "업무"}</option>)}
            </select>
          </Field>
          <Field label="채우는 축" hint="비워 두면 유형으로 정합니다 (정확도·기술 → 가능성, 수요 → 실무자 수요, 지불 → 구매자 수요)">
            <select className="select" value={axis} disabled={!diag} onChange={(e) => setAxis(e.target.value)}>
              <option value="">유형으로 정하기</option>
              {Object.entries(AXIS_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
      ) : null}
      <ErrorNote error={save.error ?? remove.error} />
      <div className="form-actions">
        <button className="pill pill--ink pill--sm" disabled={save.busy || statement.length < 5} onClick={() => void save.run()}>저장</button>
        {h.status === "unverified" ? (
          <button className="pill pill--sm" disabled={remove.busy} onClick={() => { if (window.confirm("이 가설을 지울까요?")) void remove.run(); }}>지우기</button>
        ) : <span className="small muted">검증을 시작한 가설은 지울 수 없습니다.</span>}
      </div>
    </div>
  );
}

function MentorAsk({ projectId, h }: { projectId: string; h: H }) {
  const [sent, setSent] = useState(false);
  const ask = useAction(async () => {
    await api(`/api/projects/${projectId}/mentor-requests`, { body: { hypothesis_id: h.id, topic: `치명 후보 평정: ${h.statement.slice(0, 200)}` } });
    setSent(true);
  });
  if (sent) return <Note tone="good"><p>외부 평가자 연결을 요청했습니다. 배정되면 알림으로 알려 드립니다.</p></Note>;
  return (
    <div className="form-actions">
      <span className="small muted">팀 밖 평가자를 구하지 못했나요?</span>
      <button className="pill pill--sm" disabled={ask.busy} onClick={() => void ask.run()}>제휴 멘토 연결 요청</button>
      <ErrorNote error={ask.error} />
    </div>
  );
}

function HypothesisRow({ projectId, h, rank, reload, diags }: { projectId: string; h: H; rank: number; reload: () => Promise<void>; diags: Diag[] }) {
  const { canEdit, canRate } = useProject();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const mine = h.ratings.find((r) => r.rater_user_id === session?.user?.id);
  const [level, setLevel] = useState<Level>(mine?.level ?? "major");
  const [note, setNote] = useState(mine?.note ?? "");
  const rate = useAction(async () => {
    await api(`/api/projects/${projectId}/hypotheses/${h.id}/ratings`, { body: { level, note } });
    toast("중요도를 매겼습니다");
    await reload();
  });
  const settle = useAction(async (l: Level) => {
    await api(`/api/projects/${projectId}/hypotheses/${h.id}/settle`, { body: { level: l } });
    await reload();
  });
  const llm = h.ratings.find((r) => r.rater_type === "llm");
  // 내가 매기기 전에는 다른 사람의 평정을 보여주지 않는다 (서로 보지 않고 매긴다)
  const showOthers = !canRate || !!mine;

  return (
    <div style={{ borderBottom: "1px solid var(--rule)" }}>
      <div className="row" style={{ borderBottom: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr)", gap: 12 }}>
          <span className="num" style={{ fontSize: 24, lineHeight: 1.1 }}>{rank}</span>
          <div>
            <div className="row__title">{h.statement}</div>
            <div className="row__meta">
              <span className="badge">{TYPE_KO[h.type] ?? h.type}</span>
              <CriticalityTag level={h.criticality} />
              <EvidenceLadder level={h.evidence_level} />
              <HypothesisStatus status={h.status} />
              {h.critical_candidate ? <span className="badge badge--not_met">진단에서 치명 후보</span> : null}
              {h.consensus.needsDiscussion ? <span className="badge badge--on_hold">평정이 엇갈림</span> : null}
              {h.consensus.needsExternalRater ? <span className="badge badge--info">팀 밖 평가자 필요</span> : null}
              {h.consensus.llmFlagReview ? <span className="badge badge--on_hold">반대 평가자와 두 단계 차이</span> : null}
            </div>
          </div>
        </div>
        <div className="row__side">
          <button className="pill pill--sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "접기" : "자세히"}</button>
        </div>
      </div>
      {open ? (
        <div style={{ padding: "0 2px 18px 52px" }}>
          {h.diagnosis_id ? (
            <p className="small" style={{ marginTop: 0 }}>
              진단 연결: {diags.find((d) => d.id === h.diagnosis_id)?.tasks?.name ?? "업무"}
              {h.diagnosis_axis ? `, ${AXIS_KO[h.diagnosis_axis]}` : ", 축은 유형으로"}
            </p>
          ) : null}
          {h.premortem_reason ? <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>사전 부검: {h.premortem_reason}</p> : null}
          {h.outside_view ? (
            <p className="small">바깥 관점: 같은 유형의 가정이 다른 팀에서 미달을 받은 비율 <span className="num">{pct(h.outside_view.fail_rate)}</span> ({h.outside_view.companies}개 팀)</p>
          ) : <p className="small muted">바깥 관점: 같은 유형의 사례가 10개 팀 이상 쌓이면 보여줍니다.</p>}

          {canRate ? (
            <div className="panel panel--soft" style={{ margin: "10px 0" }}>
              <h3>내 평정</h3>
              <p className="small muted" style={{ marginTop: 0 }}>이 가정이 틀리면 아이디어가 실패하는가? 다른 사람의 평정은 내가 매긴 뒤에 보입니다.</p>
              <Segmented label="중요도" value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} />
              <p className="small" style={{ margin: "8px 0" }}>{LEVELS.find((l) => l.value === level)?.anchor}</p>
              <Field label="근거 메모 (선택)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <ErrorNote error={rate.error} />
              <button className="pill pill--ink pill--sm" disabled={rate.busy} onClick={() => void rate.run()}>{mine ? "다시 매기기" : "매기기"}</button>
            </div>
          ) : null}

          {showOthers && h.ratings.length ? (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="t">
                <thead><tr><th>평가자</th><th>구분</th><th>중요도</th><th>메모</th></tr></thead>
                <tbody>
                  {h.ratings.map((r, i) => (
                    <tr key={i}>
                      <td>{r.rater_name}</td>
                      <td>{r.rater_type === "llm" ? "LLM 반대 평가자 (참고)" : r.rater_type === "external" ? "팀 밖" : "팀"}</td>
                      <td><CriticalityTag level={r.level} /></td>
                      <td style={{ whiteSpace: "normal" }}>{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {llm && showOthers ? <p className="small muted">LLM 반대 평가자의 평정은 합의에 넣지 않고, 사람 평정과 크게 다를 때 토론 거리로만 씁니다.</p> : null}

          {canEdit && h.consensus.needsDiscussion ? (
            <div style={{ marginTop: 10 }}>
              <p className="small" style={{ margin: "0 0 6px" }}>토론한 뒤 확정하기</p>
              <div className="form-actions" style={{ marginTop: 0 }}>
                {LEVELS.map((l) => <button key={l.value} className="pill pill--sm" disabled={settle.busy} onClick={() => void settle.run(l.value)}>{l.label}로 확정</button>)}
              </div>
              <ErrorNote error={settle.error} />
            </div>
          ) : null}
          {canEdit && (h.critical_candidate || h.criticality === "critical" || h.consensus.needsExternalRater) && !h.ratings.some((r) => r.rater_type === "external") ? (
            <MentorAsk projectId={projectId} h={h} />
          ) : null}
          {canEdit && editing ? <EditPanel projectId={projectId} h={h} diags={diags} reload={async () => { setEditing(false); await reload(); }} /> : null}
          {canEdit ? (
            <div className="form-actions">
              <Link className="pill pill--go pill--sm" href={`/projects/${projectId}/proposals?hypothesis=${h.id}`}>이 가정의 검증 제안 만들기</Link>
              <button className="pill pill--sm" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{editing ? "고치기 닫기" : "고치기·진단 연결"}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const { data, loading, error, reload: reloadList } = useApi<{ hypotheses: H[] }>(`/api/projects/${projectId}/hypotheses`);
  const reload = useCallback(async () => {
    await reloadList();
    emitChange("hypotheses");
  }, [reloadList]);
  const diagnoses = useApi<{ diagnoses: Diag[] }>(`/api/projects/${projectId}/diagnoses`);
  const [premortem, setPremortem] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState("");
  const [type, setType] = useState("demand");
  const draft = useAction(async () => {
    const r = await api<{ premortem: string[] }>(`/api/projects/${projectId}/hypotheses`, { body: { draft: true } });
    setPremortem(r.premortem);
    await reload();
  });
  const add = useAction(async () => {
    await api(`/api/projects/${projectId}/hypotheses`, { body: { statement, type } });
    setStatement("");
    setAdding(false);
    await reload();
  });
  const devil = useAction(async () => {
    const r = await api<{ needs_review: string[] }>(`/api/projects/${projectId}/hypotheses/devils-advocate`, { method: "POST" });
    toast(r.needs_review.length ? `${r.needs_review.length}개 가정이 반대 평가자와 크게 다릅니다` : "반대 평가자와 크게 다른 가정이 없습니다");
    await reload();
  });
  const list = data?.hypotheses ?? [];

  return (
    <>
      <ErrorNote error={error ?? draft.error ?? devil.error} />
      {premortem.length ? (
        <Note tone="info">
          <p><strong>&ldquo;1년 뒤 이 아이디어가 실패했다면&rdquo;에서 나온 이유</strong></p>
          {premortem.map((p) => <p key={p}>{p}</p>)}
        </Note>
      ) : null}
      <section className="section">
        <div className="section__head">
          <div>
            <h2>검증 순서</h2>
            <p>중요도가 높은 것부터, 같은 중요도에서는 증거가 약한 것부터 검증합니다. 두 척도는 곱하지 않습니다.</p>
          </div>
          {canEdit ? (
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button className="pill pill--ink" disabled={draft.busy} onClick={() => void draft.run()}>{draft.busy ? "찾는 중" : "실패 이유로 가정 찾기"}</button>
              <button className="pill" onClick={() => setAdding((v) => !v)}>직접 추가</button>
              <button className="pill pill--quiet" disabled={devil.busy || list.length === 0} onClick={() => void devil.run()}>반대 평가자 돌리기</button>
            </div>
          ) : null}
        </div>
        {adding ? (
          <div className="panel" style={{ marginBottom: 16 }}>
            <Field label="가정" hint="측정할 수 있게 씁니다. 예: 고객이 받아들이는 최소 정확도는 95%다">
              <input className="input" value={statement} onChange={(e) => setStatement(e.target.value)} />
            </Field>
            <Field label="유형">
              <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(TYPE_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <ErrorNote error={add.error} />
            <button className="pill pill--ink" disabled={add.busy || statement.length < 5} onClick={() => void add.run()}>추가</button>
          </div>
        ) : null}
        {loading ? <Loading lines={5} /> : list.length === 0 ? (
          <Empty title="아직 가정이 없습니다">&ldquo;실패 이유로 가정 찾기&rdquo;를 누르면 결과물 신뢰, 기대 정확도, 데이터 확보 같은 AI 특화 가정부터 뽑습니다.</Empty>
        ) : (
          <div className="rows rows--feature">
            {list.map((h, i) => <HypothesisRow key={h.id} projectId={projectId} h={h} rank={i + 1} reload={reload} diags={diagnoses.data?.diagnoses ?? []} />)}
          </div>
        )}
      </section>
      <ReadOnlyHint />
    </>
  );
}

function HypStage({ projectId, name }: { projectId: string; name: string }) {
  const { data, reload } = useApi<{ hypotheses: H[] }>(`/api/projects/${projectId}/hypotheses`);
  useOnChange("hypotheses", reload);
  const first = data?.hypotheses.find((h) => !["met"].includes(h.status)) ?? data?.hypotheses[0];
  const idx = first ? EVIDENCE_LEVELS.indexOf(first.evidence_level as (typeof EVIDENCE_LEVELS)[number]) : 0;
  return (
    <Stage crumb={<><b>가설</b>{name}</>} seed={3}
      actions={first ? <Link className="pill pill--go" href={`/projects/${projectId}/proposals?hypothesis=${first.id}`}>이 가정 검증하기</Link> : null}
      aside={first ? <span className="stage__note"><EvidenceLadder level={first.evidence_level} onStage /></span> : null}>
      <TiltCard kicker="지금 검증할 가정" title={first?.statement ?? "아직 가정이 없습니다"} sub={first ? `${TYPE_KO[first.type]} 가정` : undefined}>
        {first ? (
          <>
            <Ring value={idx} max={4} display={first.evidence_level} unit="" label="증거 수준" tone="cyan" />
            <Ring value={first.consensus.humanRaterCount} max={3} display={String(first.consensus.humanRaterCount)} unit="명" label="사람 평정" tone="yellow" />
            <Ring value={first.criticality === "critical" ? 1 : first.criticality === "major" ? 0.66 : first.criticality ? 0.33 : 0}
              display={first.criticality ? { critical: "치명", major: "중대", minor: "경미" }[first.criticality] : "미정"} unit="" label="중요도" tone="coral" />
          </>
        ) : null}
      </TiltCard>
    </Stage>
  );
}

export default function HypothesesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <HypStage projectId={projectId} name={projectName(info?.project.name)} />}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
