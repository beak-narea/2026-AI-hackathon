"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ProjectShell, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { EvidenceLadder, VERDICT_KO, VerdictBadge } from "@/components/badges";
import { DecisionTable, type TableRow } from "@/components/DecisionTable";
import { api, dateKo, pct, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Loading, Note } from "@/components/ui";
import { projectName } from "@/lib/client/format";
import { decisionTable } from "@/lib/stats/verdict";

interface V {
  id: string; hypothesis_id: string; proposal_id: string; root_proposal_id: string; result: string; look_number: number;
  n: number; successes: number; raw_n: number; target_value: number; min_value: number; p_above_target: number; p_below_min: number;
  wilson_low: number; wilson_high: number; evidence_level: string; created_at: string; evidence_ids: string[];
  hypotheses: { statement: string; type: string; status: string } | null;
  proposals: { method: string } | null;
}
interface PDetail { proposal: { decision_table: TableRow[]; look_number: number }; evidence: Array<{ id: string; quality_flags: string[]; responses: number; successes: number; acquaintance_ratio: number | null; has_raw: boolean }> }

function useSelected(projectId: string) {
  const params = useSearchParams();
  const { data, loading, error, reload } = useApi<{ verdicts: V[] }>(`/api/projects/${projectId}/verdicts`);
  const list = data?.verdicts ?? [];
  const byVerdict = params.get("verdict");
  const byProposal = params.get("proposal");
  const asked = list.find((x) => x.id === byVerdict) ?? list.find((x) => x.proposal_id === byProposal) ?? list.find((x) => x.root_proposal_id === byProposal);
  const v = asked ?? list[0];
  // 주소로 고른 판정이 없으면(판정하지 않은 결과 등) 다른 판정을 보여 준다는 것을 알린다
  const missed = !!(byVerdict || byProposal) && !asked && list.length > 0;
  return { list, v, missed, loading, error, reload };
}

const EXPLAIN: Record<string, string> = {
  met: "실제 비율이 목표값을 넘을 확률이 80% 이상입니다.",
  not_met: "실제 비율이 최소 허용치에 못 미칠 확률이 80% 이상입니다.",
  on_hold: "충족도 미달도 아닙니다. 표본을 늘려 다시 판정할 수 있습니다 (처음 판정을 포함해 최대 4회).",
  no_conclusion: "재판정 상한까지 결론이 나지 않았습니다. 목표값과 최소 허용치 간격을 넓히거나 더 강한 증거를 얻는 방법으로 새 제안을 만듭니다.",
};

/** 관측 표본 수의 행이 표에 없으면 같은 규칙으로 계산해 끼워 넣는다 */
function withObserved(rows: TableRow[], v: V): TableRow[] {
  const n = Math.round(v.n);
  if (rows.some((r) => r.n === n)) return rows;
  const [extra] = decisionTable([n], { target: v.target_value, min: v.min_value });
  return [...rows, extra!].sort((a, b) => a.n - b.n);
}

function Body({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { canEdit } = useProject();
  const { list, v, missed, loading, error } = useSelected(projectId);
  const detail = useApi<PDetail>(v ? `/api/projects/${projectId}/proposals/${v.proposal_id}` : null);
  const chain = useApi<{ proposals: Array<{ id: string; root_proposal_id: string | null; look_number: number }> }>(`/api/projects/${projectId}/proposals`);
  // 이 판정 뒤에 만든 재판정 제안이 이미 있으면 버튼 대신 그 제안으로 보낸다
  const pending = v ? (chain.data?.proposals ?? []).find((p) => p.root_proposal_id === v.root_proposal_id && p.look_number > v.look_number) : undefined;
  const rejudge = useAction(async () => {
    const r = await api<{ proposal: { id: string } }>(`/api/projects/${projectId}/proposals/${v!.proposal_id}/rejudge`, { method: "POST" });
    router.push(`/projects/${projectId}/proposals/${r.proposal.id}`);
  });
  if (loading) return <Loading lines={6} />;
  if (error) return <ErrorNote error={error} />;
  if (!v) return <Empty title="아직 판정이 없습니다" />;
  const flags = (detail.data?.evidence ?? []).flatMap((e) => e.quality_flags);
  return (
    <>
      {missed ? <Note tone="info"><p>고른 결과에는 판정이 없습니다 (진술 증거라 판정하지 않았거나 아직 결과가 없습니다). 가장 최근 판정을 보여 줍니다.</p></Note> : null}
      <section className="section">
        <div className="section__head">
          <div>
            <h2>{VERDICT_KO[v.result]}인 이유</h2>
            <p>{EXPLAIN[v.result]}</p>
          </div>
          <div className="form-actions" style={{ marginTop: 0 }}>
            {canEdit && v.result === "on_hold" && v.look_number < 4 && pending ? (
              <Link className="pill pill--ink" href={`/projects/${projectId}/proposals/${pending.id}`}>재판정 {pending.look_number}회차 제안 보기</Link>
            ) : canEdit && v.result === "on_hold" && v.look_number < 4 && chain.data ? (
              <button className="pill pill--ink" disabled={rejudge.busy} onClick={() => void rejudge.run()}>표본 늘려 다시 판정</button>
            ) : null}
            {canEdit && v.result !== "on_hold" ? (
              <Link className="pill pill--go" href={`/projects/${projectId}/decisions?hypothesis=${v.hypothesis_id}`}>결정 기록하기</Link>
            ) : null}
          </div>
        </div>
        <ErrorNote error={rejudge.error} />
        <div className="grid2">
          <div className="panel">
            <h3>관측</h3>
            <p style={{ margin: 0 }}>
              <span className="num" style={{ fontSize: 30 }}>{v.successes % 1 ? v.successes.toFixed(1) : v.successes}/{v.n % 1 ? v.n.toFixed(1) : v.n}</span>
            </p>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              {v.n !== v.raw_n ? `실제 응답 ${v.raw_n}명을 묶음 보정한 유효 표본입니다. ` : ""}95% 범위 {pct(v.wilson_low)}~{pct(v.wilson_high)} (Wilson)
            </p>
          </div>
          <div className="panel">
            <h3>기준과 증거</h3>
            <p style={{ margin: 0 }}>목표값 <span className="num">{pct(v.target_value)}</span>, 최소 허용치 <span className="num">{pct(v.min_value)}</span></p>
            <p className="small" style={{ margin: "6px 0 0" }}><EvidenceLadder level={v.evidence_level} /> 판정 {v.look_number}회차, {dateKo(v.created_at)}</p>
          </div>
        </div>
        {flags.length ? <div style={{ marginTop: 14 }}><Note tone="warn">{[...new Set(flags)].map((f) => <p key={f}>{f}</p>)}</Note></div> : null}
      </section>
      {detail.data ? (
        <section className="section">
          <div className="section__head"><div><h2>잠가 둔 결정표</h2></div></div>
          <DecisionTable rows={withObserved(detail.data.proposal.decision_table, v)} highlight={Math.round(v.n)} />
        </section>
      ) : null}
      {list.length > 1 ? (
        <section className="section">
          <div className="section__head"><h2>다른 판정</h2></div>
          <div className="rows">
            {list.filter((x) => x.id !== v.id).map((x) => (
              <Link key={x.id} className="row" href={`/projects/${projectId}/verdicts?verdict=${x.id}`}>
                <div>
                  <div className="row__title">{x.hypotheses?.statement}</div>
                  <div className="row__meta"><span className="num">{x.successes}/{x.n}</span><EvidenceLadder level={x.evidence_level} /><span>{dateKo(x.created_at)}</span></div>
                </div>
                <div className="row__side"><VerdictBadge result={x.result} /></div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function VerdictStage({ projectId, name }: { projectId: string; name: string }) {
  const { v } = useSelected(projectId);
  return (
    <Stage crumb={<><b>검증 · 판정</b>{name}</>} seed={7}
      aside={v ? <span className="stage__note"><EvidenceLadder level={v.evidence_level} onStage /></span> : null}
      actions={v ? <VerdictBadge result={v.result} /> : null}>
      <TiltCard kicker={v?.hypotheses?.statement ?? "판정"} title={v ? VERDICT_KO[v.result] : "아직 판정 전"} sub={v?.proposals?.method}>
        {v ? (
          <>
            <Ring value={v.p_above_target} label="목표값을 넘을 확률" tone="teal" />
            <Ring value={v.p_below_min} label="최소 허용치 미만일 확률" tone="coral" />
            <Ring value={v.successes / v.n} label="관측 비율" tone="cyan" />
            <Ring value={v.look_number} max={4} display={String(v.look_number)} unit="/4" label="판정 회차" tone="yellow" />
          </>
        ) : null}
      </TiltCard>
    </Stage>
  );
}

export default function VerdictsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <Suspense><VerdictStage projectId={projectId} name={projectName(info?.project.name)} /></Suspense>}>
      <Suspense><Body projectId={projectId} /></Suspense>
    </ProjectShell>
  );
}
