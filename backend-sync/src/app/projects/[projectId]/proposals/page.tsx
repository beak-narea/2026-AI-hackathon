"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { EvidenceLadder, ProposalStatus } from "@/components/badges";
import { api, dateKo, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading } from "@/components/ui";
import { projectName } from "@/lib/client/format";

interface Proposal { id: string; hypothesis_id: string; method: string; status: string; look_number: number; sample_size: number | null; locked_at: string | null; created_at: string; evidence_level_expected: string; conclusion_probability: number | null }
interface Method { key: string; name: string; evidence_level: string; measures: string; defaults: { target: number; min: number; expected: number } }

function NewProposal({ projectId, hypotheses }: { projectId: string; hypotheses: Array<{ id: string; statement: string }> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [hid, setHid] = useState(params.get("hypothesis") ?? "");
  useEffect(() => {
    if (!hid && hypotheses[0]) setHid(hypotheses[0].id);
  }, [hid, hypotheses]);
  const methods = useApi<{ methods: Method[] }>(hid ? `/api/projects/${projectId}/hypotheses/${hid}/methods` : null);
  // 실험 방법은 가정 유형과 고객을 만나는 방식에 맞춰 서비스가 고른다 (목록의 첫 방법이 추천)
  const [method, setMethod] = useState("");
  const list = methods.data?.methods ?? [];
  const m = list.find((x) => x.key === method) ?? list[0];
  const gen = useAction(async () => {
    const r = await api<{ proposal: { id: string } }>(`/api/projects/${projectId}/proposals`, { body: { hypothesis_id: hid, method_key: m?.key } });
    router.push(`/projects/${projectId}/proposals/${r.proposal.id}`);
  });
  return (
    <div className="panel">
      <h3>새 검증 실험 및 MVP 기획서</h3>
      <p className="small muted" style={{ marginTop: 0 }}>검증할 가정만 고르면 됩니다. 실험 방법은 가정에 맞게 고르고, 표본 수와 결정표는 코드로 계산합니다.</p>
      <Field label="검증할 가정">
        <select className="select" value={hid} onChange={(e) => { setHid(e.target.value); setMethod(""); }}>
          {hypotheses.map((h) => <option key={h.id} value={h.id}>{h.statement}</option>)}
        </select>
      </Field>
      {m ? (
        <p className="small" style={{ margin: "0 0 12px" }}>
          이 가정은 <strong>{m.name}</strong>으로 확인합니다 (<EvidenceLadder level={m.evidence_level} />). 재는 것: {m.measures}
          {list.length > 1 && method === "" ? (
            <> <button type="button" className="linkish" onClick={() => setMethod(list[1]!.key)}>다른 방법 보기</button></>
          ) : null}
        </p>
      ) : null}
      {list.length > 1 && method !== "" ? (
        <Field label="실험 방법">
          <select className="select" value={m?.key ?? ""} onChange={(e) => setMethod(e.target.value)}>
            {list.map((x, i) => <option key={x.key} value={x.key}>{x.name}{i === 0 ? " (추천)" : ""}</option>)}
          </select>
        </Field>
      ) : null}
      {methods.data && list.length === 0 ? <p className="small">이 가정 유형에 맞는 실험 방법이 없습니다. 가설 화면에서 가정의 유형을 바꿔 주세요.</p> : null}
      <ErrorNote error={gen.error} />
      <button className="pill pill--ink" disabled={gen.busy || !m} onClick={() => void gen.run()}>{gen.busy ? "기획서 쓰는 중" : "기획서 만들기"}</button>
    </div>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const { data, loading, error } = useApi<{ proposals: Proposal[] }>(`/api/projects/${projectId}/proposals`);
  const hyps = useApi<{ hypotheses: Array<{ id: string; statement: string }> }>(`/api/projects/${projectId}/hypotheses`);
  const statement = (id: string) => hyps.data?.hypotheses.find((h) => h.id === id)?.statement ?? "";
  return (
    <>
      <ErrorNote error={error} />
      {canEdit && hyps.data?.hypotheses.length ? <section className="section"><Suspense><NewProposal projectId={projectId} hypotheses={hyps.data.hypotheses} /></Suspense></section> : null}
      <section className="section">
        <div className="section__head"><h2>기획서</h2></div>
        {loading ? <Loading /> : (data?.proposals ?? []).length === 0 ? (
          <Empty title="아직 기획서가 없습니다">가설 화면에서 검증할 가정을 고르면 기획서를 만들 수 있습니다.</Empty>
        ) : (
          <div className="rows rows--feature">
            {data!.proposals.map((p) => (
              <Link key={p.id} className="row" href={`/projects/${projectId}/proposals/${p.id}`}>
                <div>
                  <div className="row__title">{statement(p.hypothesis_id)}</div>
                  <div className="row__meta">
                    <span>{p.method}</span>
                    <EvidenceLadder level={p.evidence_level_expected} />
                    <span>{p.locked_at ? `기준 잠금 ${dateKo(p.locked_at)}` : "기준 잠금 전"}</span>
                  </div>
                </div>
                <div className="row__side"><ProposalStatus status={p.status} /></div>
              </Link>
            ))}
          </div>
        )}
      </section>
      <ReadOnlyHint />
    </>
  );
}

function ListStage({ projectId, name }: { projectId: string; name: string }) {
  const { data } = useApi<{ proposals: Proposal[] }>(`/api/projects/${projectId}/proposals`);
  const ps = data?.proposals ?? [];
  const n = (s: string) => ps.filter((p) => p.status === s).length;
  return (
    <Stage short crumb={<><b>검증 · 기획서</b>{name}</>} seed={4}>
      <TiltCard title="검증 실험 및 MVP 기획서" sub="실험은 팀이 직접 하거나 사내 AX 프로세스로 돌립니다. 서비스는 기획서를 드리고 결과를 받습니다.">
        <Ring value={n("draft")} max={Math.max(ps.length, 1)} display={String(n("draft"))} unit="건" label="작성 중" tone="stone" />
        <Ring value={n("sent") + n("awaiting")} max={Math.max(ps.length, 1)} display={String(n("sent") + n("awaiting"))} unit="건" label="결과 대기" tone="yellow" />
        <Ring value={n("received")} max={Math.max(ps.length, 1)} display={String(n("received"))} unit="건" label="결과 수령" tone="teal" />
      </TiltCard>
    </Stage>
  );
}

export default function ProposalsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <ListStage projectId={projectId} name={projectName(info?.project.name)} />}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
