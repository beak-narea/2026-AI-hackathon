"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProjectShell, useProject, type ProjectInfo } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { EvidenceLadder, ProposalStatus, VerdictBadge } from "@/components/badges";
import { Empty, ErrorNote, Field, Loading, toast } from "@/components/ui";
import { api, dateKo, useAction } from "@/lib/client/api";
import { useState } from "react";
import { firstSentence, projectName } from "@/lib/client/format";

const ACTION_HREF: Record<string, (p: string, t?: string) => string> = {
  "business_model.extract": (p) => `/projects/${p}/business-model`,
  "hypothesis.create": (p) => `/projects/${p}/hypotheses`,
  "hypothesis.rate_criticality": (p) => `/projects/${p}/hypotheses`,
  "decision.record": (p, t) => `/projects/${p}/decisions?hypothesis=${t}`,
  "evidence.submit": (p, t) => `/projects/${p}/results?proposal=${t}`,
};

function DashStage({ info }: { info: ProjectInfo | null }) {
  const c = info?.hypothesis_status_counts ?? {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const ring = (k: string[]) => k.reduce((a, b) => a + (c[b] ?? 0), 0);
  return (
    <Stage
      crumb={<><b>대시보드</b><Link href="/projects">프로젝트 목록</Link></>}
      actions={info ? <Link className="pill pill--go" href={`/projects/${info.project.id}/hypotheses`}>가설 보기</Link> : null}
      aside={info ? <span className="stage__note">가설 {total}개</span> : null}
    >
      <TiltCard title={projectName(info?.project.name) || " "} sub={firstSentence(info?.project.idea_text)}>
        <Ring value={ring(["met"])} max={Math.max(total, 1)} display={String(ring(["met"]))} unit="개" label="충족" tone="teal" />
        <Ring value={ring(["not_met", "needs_recheck"])} max={Math.max(total, 1)} display={String(ring(["not_met", "needs_recheck"]))} unit="개" label="미달·재검증" tone="coral" />
        <Ring value={ring(["on_hold", "in_progress"])} max={Math.max(total, 1)} display={String(ring(["on_hold", "in_progress"]))} unit="개" label="검증 중" tone="yellow" />
        <Ring value={ring(["unverified"])} max={Math.max(total, 1)} display={String(ring(["unverified"]))} unit="개" label="미검증" tone="cyan" />
      </TiltCard>
    </Stage>
  );
}

const SCREEN_HREF: Record<string, (p: string, t?: string) => string> = {
  hypotheses: (p) => `/projects/${p}/hypotheses`,
  proposals: (p, t) => (t ? `/projects/${p}/proposals?hypothesis=${t}` : `/projects/${p}/proposals`),
  proposal: (p, t) => (t ? `/projects/${p}/proposals/${t}` : `/projects/${p}/proposals`),
  decisions: (p, t) => `/projects/${p}/decisions${t ? `?hypothesis=${t}` : ""}`,
  business_model: (p) => `/projects/${p}/business-model`,
  diagnosis: (p) => `/projects/${p}/diagnosis`,
};

function ReviewPanel({ projectId }: { projectId: string }) {
  const { info, canEdit, reload } = useProject();
  const [note, setNote] = useState("");
  const record = useAction(async () => {
    await api(`/api/projects/${projectId}/review`, { body: { note } });
    setNote("");
    toast("점검을 기록했습니다");
    await reload();
  });
  const c = info?.cycle;
  const warnings = info?.warnings ?? [];
  if (!c) return null;
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>점검</h2>
          <p>
            {c.last_reviewed_at ? `마지막 점검 ${dateKo(c.last_reviewed_at)}, ` : ""}
            {c.overdue ? <strong>점검일이 지났습니다.</strong> : `다음 점검까지 ${c.days_left}일`}
          </p>
        </div>
      </div>
      {warnings.length ? (
        <ul className="warn-list" aria-label="증거와 계획이 맞지 않는 곳">
          {warnings.map((w, i) => (
            <li key={i} className={w.severity}>
              <span className={`badge badge--${w.severity === "high" ? "not_met" : "on_hold"}`}>{w.severity === "high" ? "먼저" : "확인"}</span>
              <span>{w.message}</span>
              <Link href={(SCREEN_HREF[w.screen] ?? ((p: string) => `/projects/${p}`))(projectId, w.target)}>열기</Link>
            </li>
          ))}
        </ul>
      ) : <p className="muted">증거와 계획이 어긋난 곳이 없습니다.</p>}
      {canEdit ? (
        <div className="sub" style={{ marginTop: 14 }}>
          <Field label="점검 메모 (선택)">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorNote error={record.error} />
          <button className="pill" disabled={record.busy} onClick={() => void record.run()}>점검 기록</button>
        </div>
      ) : null}
    </section>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { info } = useProject();
  if (!info) return <Loading lines={6} />;
  return (
    <>
      <ReviewPanel projectId={projectId} />
      <section className="section">
        <div className="section__head"><h2>다음 할 일</h2></div>
        {info.next_actions.length === 0 ? (
          <Empty title="지금 할 일이 없습니다" />
        ) : (
          <div className="rows rows--feature">
            {info.next_actions.map((a, i) => (
              <Link className="row" key={i} href={(ACTION_HREF[a.action] ?? ((p: string) => `/projects/${p}`))(projectId, a.target)}>
                <div className="row__title">{a.label}</div>
                <div className="row__side"><span className="pill pill--sm">열기</span></div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <div className="grid2">
        <section className="section">
          <div className="section__head"><h2>결과를 기다리는 제안</h2></div>
          {info.pending_proposals.length === 0 ? (
            <p className="muted">팀에 보낸 검증 제안이 없습니다.</p>
          ) : (
            <div className="rows">
              {info.pending_proposals.map((p) => (
                <Link className="row" key={p.id} href={`/projects/${projectId}/proposals/${p.id}`}>
                  <div>
                    <div className="row__title">{p.method}</div>
                    <div className="row__meta">표본 {p.sample_size ?? "–"}명{p.look_number > 1 ? `, 재판정 ${p.look_number}회차` : ""}</div>
                  </div>
                  <div className="row__side"><ProposalStatus status={p.status} /></div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="section">
          <div className="section__head"><h2>최근 판정</h2></div>
          {info.recent_verdicts.length === 0 ? (
            <p className="muted">아직 판정이 없습니다.</p>
          ) : (
            <div className="rows">
              {info.recent_verdicts.map((v) => (
                <Link className="row" key={v.id} href={`/projects/${projectId}/verdicts?verdict=${v.id}`}>
                  <div>
                    <div className="row__title num">{v.successes}/{v.n}</div>
                    <div className="row__meta"><EvidenceLadder level={v.evidence_level} /> {dateKo(v.created_at)}</div>
                  </div>
                  <div className="row__side"><VerdictBadge result={v.result} /></div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <DashStage info={info} />}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
