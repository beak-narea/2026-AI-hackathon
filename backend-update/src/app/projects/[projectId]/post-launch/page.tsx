"use client";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { VerdictBadge } from "@/components/badges";
import { api, dateKo, pct, useAction, useApi, emitChange, useOnChange } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";

interface Card {
  id: string; event_name: string; definition: string; target_value: number; min_value: number; alert_rule: string; locked_at: string | null;
  relocked: boolean; source: { numerator_event: string; denominator_event: string; window_days: number } | null; actual_value: number | null; actual_n: number | null; recheck_result: string | null; observed_at: string | null;
  metric_observations: Array<{ id: string; successes: number; n: number; result: string; source: string; created_at: string }>;
}

function SourceEditor({ projectId, c, reload }: { projectId: string; c: Card; reload: () => Promise<void> }) {
  const [num, setNum] = useState(c.source?.numerator_event ?? c.event_name);
  const [den, setDen] = useState(c.source?.denominator_event ?? "");
  const [win, setWin] = useState(String(c.source?.window_days ?? 30));
  const save = useAction(async (clear: boolean) => {
    await api(`/api/projects/${projectId}/metric-cards/${c.id}/source`, {
      method: "PUT",
      body: { source: clear ? null : { numerator_event: num, denominator_event: den, window_days: Number(win) || 30 } },
    });
    toast(clear ? "자동 측정을 껐습니다" : "자동 측정 이벤트를 정했습니다");
    await reload();
  });
  return (
    <div className="sub" style={{ marginTop: 10 }}>
      <p className="small" style={{ margin: "0 0 10px" }}>
        자동 측정 (PostHog·Amplitude 연결 시): 기간 안에 분자 이벤트를 남긴 사람 ÷ 분모 이벤트를 남긴 사람을 매일 재고 같은 기준으로 다시 판정합니다.
        {c.source ? <strong> 지금: {c.source.numerator_event} ÷ {c.source.denominator_event}, 최근 {c.source.window_days}일</strong> : null}
      </p>
      <div className="grid3">
        <Field label="분자 이벤트 (행동)"><input className="input" value={num} onChange={(e) => setNum(e.target.value)} /></Field>
        <Field label="분모 이벤트 (기회)" hint="예: ai_feature_viewed"><input className="input" value={den} onChange={(e) => setDen(e.target.value)} /></Field>
        <Field label="기간 (일)"><input className="input" inputMode="numeric" value={win} onChange={(e) => setWin(e.target.value)} /></Field>
      </div>
      <ErrorNote error={save.error} />
      <div className="form-actions">
        <button className="pill pill--sm" disabled={save.busy || !num || !den} onClick={() => void save.run(false)}>저장</button>
        {c.source ? <button className="pill pill--sm pill--quiet" disabled={save.busy} onClick={() => void save.run(true)}>자동 측정 끄기</button> : null}
      </div>
    </div>
  );
}

function CardPanel({ projectId, c, reload, tilt }: { projectId: string; c: Card; reload: () => Promise<void>; tilt: boolean }) {
  const { canEdit } = useProject();
  const [edit, setEdit] = useState(false);
  const [def, setDef] = useState(c.definition);
  const [target, setTarget] = useState(String(Math.round(c.target_value * 100)));
  const [min, setMin] = useState(String(Math.round(c.min_value * 100)));
  const [succ, setSucc] = useState("");
  const [n, setN] = useState("");
  const save = useAction(async () => {
    await api(`/api/projects/${projectId}/metric-cards/${c.id}`, { method: "PATCH", body: { definition: def, target_value: Number(target) / 100, min_value: Number(min) / 100 } });
    setEdit(false);
    await reload();
  });
  const lock = useAction(async () => {
    await api(`/api/projects/${projectId}/metric-cards/${c.id}/lock`, { method: "POST" });
    toast("지표 카드를 잠갔습니다");
    await reload();
  });
  const observe = useAction(async () => {
    const r = await api<{ note: string | null }>(`/api/projects/${projectId}/metric-cards/${c.id}/observations`, { body: { successes: Number(succ), n: Number(n) } });
    toast(r.note ?? "관측값을 넣고 다시 판정했습니다");
    setSucc(""); setN("");
    await reload();
  });
  return (
    <article className={`panel${tilt ? " panel--tilt" : ""}`} style={{ marginBottom: 18 }}>
      <div className="section__head" style={{ marginBottom: 6 }}>
        <div>
          <h3 className="num" style={{ fontSize: 18 }}>{c.event_name}</h3>
          <p className="small" style={{ margin: 0 }}>{c.definition}</p>
        </div>
        <div className="row__side">
          {c.locked_at ? <span className="badge badge--ink">잠금 {dateKo(c.locked_at)}</span> : <span className="badge">잠그기 전</span>}
          {c.recheck_result ? <VerdictBadge result={c.recheck_result} /> : null}
        </div>
      </div>
      <div className="tilt__rings" style={{ justifyContent: "flex-start", marginTop: 6 }}>
        <Ring light value={c.target_value} label="목표값" tone="teal" />
        <Ring light value={c.min_value} label="최소 허용치" tone="coral" />
        <Ring light value={c.actual_value} label={c.actual_n ? `실제 (${c.actual_n}명)` : "실제"} tone="cyan" />
      </div>
      {c.relocked ? <p className="small">출시 전 기준과 달라 다시 정해 잠근 카드입니다.</p> : null}
      <p className="small muted">경보: {c.alert_rule || "없음"}</p>

      {canEdit && !c.locked_at ? (
        edit ? (
          <div className="sub">
            <Field label="출시 후 정의"><input className="input" value={def} onChange={(e) => setDef(e.target.value)} /></Field>
            <div className="grid2">
              <Field label="목표값 (%)"><input className="input" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
              <Field label="최소 허용치 (%)"><input className="input" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
            </div>
            <ErrorNote error={save.error} />
            <div className="form-actions"><button className="pill pill--ink" disabled={save.busy} onClick={() => void save.run()}>저장</button><button className="pill" onClick={() => setEdit(false)}>취소</button></div>
          </div>
        ) : (
          <div className="form-actions">
            <button className="pill" onClick={() => setEdit(true)}>정의와 기준 고치기</button>
            <button className="pill pill--ink" disabled={lock.busy} onClick={() => void lock.run()}>이대로 잠그기</button>
            <span className="small muted">출시 전 지표와 정의가 다르면 기준을 다시 정한 뒤 잠급니다.</span>
          </div>
        )
      ) : null}

      {canEdit && c.locked_at ? (
        <div className="sub" style={{ marginTop: 10 }}>
          <p className="small" style={{ margin: "0 0 10px" }}>관측값 직접 넣기 (데이터 연결을 하면 자동으로 들어옵니다)</p>
          <div className="grid3">
            <Field label="행동한 수"><input className="input" inputMode="numeric" value={succ} onChange={(e) => setSucc(e.target.value)} /></Field>
            <Field label="전체 수"><input className="input" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} /></Field>
            <div className="field"><span>&nbsp;</span><button className="pill pill--ink" disabled={observe.busy || !succ || !n} onClick={() => void observe.run()}>다시 판정</button></div>
          </div>
          <ErrorNote error={observe.error ?? lock.error} />
        </div>
      ) : null}
      {canEdit && c.locked_at ? <SourceEditor projectId={projectId} c={c} reload={reload} /> : null}

      {c.metric_observations.length ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="t">
            <thead><tr><th>관측일</th><th>값</th><th>출처</th><th>판정</th></tr></thead>
            <tbody>
              {c.metric_observations.map((o) => (
                <tr key={o.id}><td>{dateKo(o.created_at)}</td><td className="num">{o.successes}/{o.n} ({pct(o.successes / o.n)})</td><td>{o.source}</td><td><VerdictBadge result={o.result} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { data, loading, error, reload: reloadOwn } = useApi<{ metric_cards: Card[] }>(`/api/projects/${projectId}/metric-cards`);
  const reload = useCallback(async () => {
    await reloadOwn();
    emitChange("metric-cards");
  }, [reloadOwn]);
  const cost = useApi<{ assumed_cost_per_task: number | null; observations: Array<{ id: string; period_start: string; period_end: string; actual_cost_per_task: number; diff_ratio: number | null; source: string }> }>(`/api/projects/${projectId}/cost-comparison`);
  if (loading) return <Loading lines={5} />;
  const cards = data?.metric_cards ?? [];
  return (
    <>
      <ErrorNote error={error} />
      <section className="section">
        <div className="section__head">
          <div>
            <h2>지표 카드</h2>
            <p>충족한 가설마다 출시 후에도 같은 행동을 잽니다. 미달이 나오면 가설을 재검증 필요로 되돌립니다.</p>
          </div>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <a className="pill" href={`/api/projects/${projectId}/tracking-plan?format=yaml`}>추적 계획 YAML</a>
            <a className="pill" href={`/api/projects/${projectId}/tracking-plan?format=csv`}>CSV</a>
          </div>
        </div>
        {cards.length === 0 ? (
          <Empty title="아직 지표 카드가 없습니다">충족 판정을 받은 가설에서 계속을 고르면 카드가 생깁니다.</Empty>
        ) : cards.map((c, i) => <CardPanel key={c.id} projectId={projectId} c={c} reload={reload} tilt={i === 0} />)}
      </section>
      <section className="section">
        <div className="section__head">
          <div>
            <h2>실제 AI 비용과 계산기 가정</h2>
            <p>LLM 모니터링 도구를 연결하면 작업당 실제 비용이 들어옵니다.</p>
          </div>
        </div>
        {(cost.data?.observations ?? []).length === 0 ? (
          <p className="muted">
            {cost.data?.assumed_cost_per_task != null ? `계산기 가정은 작업당 ${cost.data.assumed_cost_per_task.toFixed(1)}원입니다. ` : "진단 화면의 AI 운영비 계산기를 먼저 채우면 비교할 수 있습니다. "}
            아직 실제 비용이 들어오지 않았습니다.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>기간</th><th>작업당 실제 비용</th><th>가정 대비</th><th>출처</th></tr></thead>
              <tbody>
                {cost.data!.observations.map((o) => (
                  <tr key={o.id}><td>{dateKo(o.period_start)}~{dateKo(o.period_end)}</td><td className="num">{o.actual_cost_per_task.toFixed(1)}원</td>
                    <td className={o.diff_ratio !== null && o.diff_ratio > 0.2 ? "not_met" : ""}>{o.diff_ratio === null ? "–" : `${o.diff_ratio > 0 ? "+" : ""}${Math.round(o.diff_ratio * 100)}%`}</td><td>{o.source}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ReadOnlyHint />
    </>
  );
}

function PLStage({ projectId, name }: { projectId: string; name: string }) {
  const { data, reload } = useApi<{ metric_cards: Card[] }>(`/api/projects/${projectId}/metric-cards`);
  useOnChange("metric-cards", reload);
  const c = data?.metric_cards[0];
  return (
    <Stage crumb={<><b>출시 후 측정</b>{name}</>} seed={9} aside={c?.recheck_result ? <VerdictBadge result={c.recheck_result} /> : null}>
      <TiltCard kicker="출시 후에도 같은 행동을 잰다" title={c?.event_name ?? (data ? "지표 카드 없음" : "지표 카드")} sub={c?.definition}>
        {c ? (
          <>
            <Ring value={c.target_value} label="목표값" tone="teal" />
            <Ring value={c.min_value} label="최소 허용치" tone="coral" />
            <Ring value={c.actual_value} label="최근 관측" tone="cyan" />
          </>
        ) : null}
      </TiltCard>
    </Stage>
  );
}

export default function PostLaunchPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <PLStage projectId={projectId} name={projectName(info?.project.name)} />}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
