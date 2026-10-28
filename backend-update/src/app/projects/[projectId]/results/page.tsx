"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { EvidenceLadder, VerdictBadge } from "@/components/badges";
import { api, useAction, useApi } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, Note, Segmented, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";

interface Proposal { id: string; hypothesis_id: string; method: string; method_key: string; status: string; locked_at: string | null; sample_size: number | null; look_number: number; evidence_level_expected: string }
interface RawFile { path: string; name: string; kind: string }

const PILOT: Array<[string, string]> = [
  ["budget_owner_signed", "예산 권한자 서명"], ["non_refundable_fee", "환불 불가 비용"], ["real_users_and_data", "실제 사용자·데이터"],
  ["agreed_baseline_and_metric", "사전 합의한 기준선과 성공 지표"], ["known_list_price", "알려진 정식 가격"], ["named_decider", "정해진 결정 주체"], ["decision_date", "정해진 결정일"],
];

function SubmitForm({ projectId, proposal, onDone }: { projectId: string; proposal: Proposal; onDone: (r: unknown) => void }) {
  const [same, setSame] = useState<"same" | "diff">("same");
  const [diffReason, setDiffReason] = useState("");
  const [diffKind, setDiffKind] = useState<"survey" | "interview" | "other">("survey");
  const [recruitment, setRecruitment] = useState("");
  const [attempts, setAttempts] = useState("");
  const [responses, setResponses] = useState("");
  const [successes, setSuccesses] = useState("");
  const [acq, setAcq] = useState("0");
  const [sameCompany, setSameCompany] = useState("1");
  const [clusters, setClusters] = useState("");
  const [clusterSucc, setClusterSucc] = useState("");
  const [notice, setNotice] = useState<"yes" | "no">("yes");
  const [memo, setMemo] = useState("");
  const [files, setFiles] = useState<RawFile[]>([]);
  const [names, setNames] = useState("");
  const [pilot, setPilot] = useState<Record<string, boolean>>({});

  const upload = useAction(async (f: File) => {
    const form = new FormData();
    form.set("file", f);
    form.set("names", names);
    const r = await api<RawFile & { pseudonymized: Record<string, number> }>(`/api/projects/${projectId}/proposals/${proposal.id}/raw-files`, { form });
    const n = Object.values(r.pseudonymized).reduce((a, b) => a + b, 0);
    toast(n ? `식별 정보 ${n}곳을 가명으로 바꿔 저장했습니다` : "저장했습니다");
    setFiles((xs) => [...xs, { path: r.path, name: r.name, kind: r.kind }]);
  });
  const submit = useAction(async () => {
    const r = await api(`/api/projects/${projectId}/proposals/${proposal.id}/evidence`, {
      body: {
        method_same: same === "same",
        method_diff_reason: same === "diff" ? diffReason : undefined,
        actual_kind: same === "diff" ? diffKind : undefined,
        recruitment,
        attempts: Number(attempts), responses: Number(responses), successes: Number(successes),
        clusters: clusters ? Number(clusters) : undefined,
        cluster_successes: clusterSucc ? Number(clusterSucc) : undefined,
        raw_files: files,
        acquaintance_ratio: Number(acq) / 100,
        same_company_count: Number(sameCompany),
        notice_given: notice === "yes",
        pilot_conditions: proposal.method_key === "paid_pilot" ? pilot : undefined,
        memo,
      },
    });
    onDone(r);
  });
  const fe = submit.error?.fieldErrors() ?? {};

  return (
    <form className="panel panel--tilt" onSubmit={(e) => { e.preventDefault(); void submit.run(); }}>
      <h3>결과 제출 폼</h3>
      <p className="small muted" style={{ marginTop: 0 }}>{proposal.method}. 계획 표본 {proposal.sample_size ?? "–"}명. 결과는 이 폼으로만 받고, 폼이 없으면 판정하지 않습니다.</p>

      <div className="field">
        <span>실제로 쓴 방법</span>
        <Segmented label="실제로 쓴 방법" value={same} onChange={setSame} options={[{ value: "same", label: "제안과 같음" }, { value: "diff", label: "다름" }]} />
      </div>
      {same === "diff" ? (
        <div className="grid2">
          <Field label="다르게 한 이유"><input className="input" value={diffReason} onChange={(e) => setDiffReason(e.target.value)} /></Field>
          <Field label="실제 방법" hint="설문·인터뷰는 진술 증거(L1)라 판정하지 않습니다">
            <select className="select" value={diffKind} onChange={(e) => setDiffKind(e.target.value as typeof diffKind)}>
              <option value="survey">설문</option><option value="interview">인터뷰</option><option value="other">기타</option>
            </select>
          </Field>
        </div>
      ) : null}
      <Field label="대상을 어떻게 모았나" error={fe.recruitment?.[0]}><input className="input" value={recruitment} onChange={(e) => setRecruitment(e.target.value)} placeholder="예: 세무사회 명부에서 무작위 30곳" /></Field>
      <div className="grid3">
        <Field label="시도 수" hint="연락·노출한 수"><input className="input" inputMode="numeric" value={attempts} onChange={(e) => setAttempts(e.target.value)} /></Field>
        <Field label="응답 수" hint="결과를 잰 대상 수"><input className="input" inputMode="numeric" value={responses} onChange={(e) => setResponses(e.target.value)} /></Field>
        <Field label="성공 수" hint="정해 둔 행동을 한 수"><input className="input" inputMode="numeric" value={successes} onChange={(e) => setSuccesses(e.target.value)} /></Field>
      </div>
      <div className="grid3">
        <Field label="지인·기존 고객 비율 (%)"><input className="input" inputMode="numeric" value={acq} onChange={(e) => setAcq(e.target.value)} /></Field>
        <Field label="한 회사에서 가장 많이 응답한 인원"><input className="input" inputMode="numeric" value={sameCompany} onChange={(e) => setSameCompany(e.target.value)} /></Field>
        <div className="field">
          <span>대상에게 사실대로 알렸나</span>
          <Segmented label="고지 여부" value={notice} onChange={setNotice} options={[{ value: "yes", label: "알렸다" }, { value: "no", label: "못 알렸다" }]} />
        </div>
      </div>
      {Number(sameCompany) > 1 ? (
        <div className="grid2">
          <Field label="회사 수" hint="같은 회사 여러 명은 회사 단위로 셉니다"><input className="input" inputMode="numeric" value={clusters} onChange={(e) => setClusters(e.target.value)} /></Field>
          <Field label="행동한 회사 수"><input className="input" inputMode="numeric" value={clusterSucc} onChange={(e) => setClusterSucc(e.target.value)} /></Field>
        </div>
      ) : null}
      {proposal.method_key === "paid_pilot" ? (
        <div className="field">
          <span>유료 파일럿이 갖춘 조건</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
            {PILOT.map(([k, l]) => (
              <label className="check" key={k} style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={!!pilot[k]} onChange={(e) => setPilot({ ...pilot, [k]: e.target.checked })} /> <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      <div className="sub" style={{ marginBottom: 16 }}>
        <Field label="원자료 (CSV, 텍스트, 전사본)" hint="이메일·전화·주민번호·사업자번호와 아래 이름은 가명으로 바꿔 저장합니다.">
          <input className="input" type="file" accept=".csv,.txt,.md,.json,.tsv,text/plain,text/csv" disabled={upload.busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload.run(f); e.target.value = ""; }} />
        </Field>
        <Field label="원자료에 나오는 참여자·회사 이름 (쉼표로 구분, 선택)"><input className="input" value={names} onChange={(e) => setNames(e.target.value)} /></Field>
        {files.map((f) => <p className="small" key={f.path} style={{ margin: 0 }}>{f.name} 저장됨</p>)}
        <ErrorNote error={upload.error} />
      </div>
      <Field label="메모"><textarea className="textarea" style={{ minHeight: 70 }} value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      <ErrorNote error={submit.error} />
      <button className="pill pill--ink" disabled={submit.busy || !recruitment || attempts === "" || responses === "" || successes === ""}>결과 제출하고 판정 받기</button>
    </form>
  );
}

interface Insight { id: string; text: string; code_type: string; is_interpretive: boolean; needs_review: boolean; confirmed_by_user: boolean; quotes: string[] }

function InsightReview({ projectId, version }: { projectId: string; version: number }) {
  const { data, reload } = useApi<{ transcripts: Array<{ id: string; created_at: string; low_trust: boolean | null; quality_validated: boolean; insights: Insight[] }> }>(
    `/api/projects/${projectId}/transcripts?v=${version}`,
  );
  const act = useAction(async (id: string, confirmed: boolean | null) => {
    if (confirmed === null) await api(`/api/projects/${projectId}/insights/${id}`, { method: "DELETE" });
    else await api(`/api/projects/${projectId}/insights/${id}`, { method: "PATCH", body: { confirmed } });
    await reload();
  });
  const pending = (data?.transcripts ?? []).flatMap((t) => t.insights.filter((i) => i.needs_review && !i.confirmed_by_user));
  const confirmed = (data?.transcripts ?? []).flatMap((t) => t.insights.filter((i) => !i.needs_review || i.confirmed_by_user));
  if (!data?.transcripts.length) return null;
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>사람이 확정할 인사이트 <span className="num">{pending.length}</span></h2>
          <p>해석이 필요한 코드(전환 동기 등)와 코딩 일치도 기준을 아직 넘지 못한 코드는 LLM이 후보만 냅니다. 원문 인용을 보고 확정하거나 버립니다.</p>
        </div>
      </div>
      <ErrorNote error={act.error} />
      {pending.length === 0 ? <p className="muted">확정을 기다리는 인사이트가 없습니다.</p> : (
        <div className="rows">
          {pending.map((i) => (
            <div className="row" key={i.id}>
              <div>
                <div className="row__title">{i.text}</div>
                {i.quotes.map((q) => <div key={q} className="row__meta">&ldquo;{q}&rdquo;</div>)}
              </div>
              <div className="row__side">
                <span className="badge">{i.code_type}</span>
                {i.is_interpretive ? <span className="badge badge--on_hold">해석형</span> : <span className="badge badge--info">일치도 검증 전</span>}
                <button className="pill pill--sm pill--go" disabled={act.busy} onClick={() => void act.run(i.id, true)}>확정</button>
                <button className="pill pill--sm" disabled={act.busy} onClick={() => void act.run(i.id, null)}>버리기</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmed.length ? <p className="small muted">확정했거나 자동 적용된 인사이트 {confirmed.length}개는 다음 검증 제안의 재료로 씁니다.</p> : null}
    </section>
  );
}

function Transcript({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [names, setNames] = useState("");
  const [out, setOut] = useState<{ insights: Insight[]; quality: { leadingRatio: number; futureRatio: number; pastRatio: number; lowTrust: boolean; validated: boolean }; dropped_quotes: number } | null>(null);
  const run = useAction(async () => {
    setOut(await api(`/api/projects/${projectId}/transcripts`, { body: { text, names: names.split(",").map((s) => s.trim()).filter(Boolean) } }));
    onDone();
  });
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>인터뷰 전사본 분석</h2>
          <p>전사본은 진술 증거(L1)라 판정하지 않습니다. 다음 검증 제안의 재료를 뽑고, 원문에 없는 인용은 버립니다.</p>
        </div>
      </div>
      <div className="panel">
        <Field label="전사본"><textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Field label="참여자·회사 이름 (쉼표로 구분, 선택)"><input className="input" value={names} onChange={(e) => setNames(e.target.value)} /></Field>
        <ErrorNote error={run.error} />
        <button className="pill pill--ink" disabled={run.busy || text.length < 50} onClick={() => void run.run()}>{run.busy ? "분석하는 중" : "분석"}</button>
        {out ? (
          <div className="sub" style={{ marginTop: 16 }}>
            <div className="tilt__rings" style={{ justifyContent: "flex-start", marginTop: 0 }}>
              <Ring value={out.quality.pastRatio} label="과거 행동 질문" tone="teal" />
              <Ring value={out.quality.leadingRatio} label="유도 질문" tone="coral" />
              <Ring value={out.quality.futureRatio} label="미래 가정 질문" tone="yellow" />
            </div>
            {out.quality.lowTrust ? <Note tone="warn"><p>유도·미래 가정 질문이 절반을 넘어 이 인터뷰의 진술은 신뢰가 낮습니다.</p></Note> : null}
            {!out.quality.validated ? <p className="small muted">질문 분류는 아직 코딩 일치도 검증을 마치지 않아 참고용입니다.</p> : null}
            <div className="rows" style={{ marginTop: 12 }}>
              {out.insights.map((i) => (
                <div className="row" key={i.id}>
                  <div>
                    <div className="row__title">{i.text}</div>
                    {i.quotes.map((q) => <div key={q} className="row__meta">&ldquo;{q}&rdquo;</div>)}
                  </div>
                  <div className="row__side"><span className="badge">{i.code_type}</span>{i.needs_review ? <span className="badge badge--on_hold">사람이 확정</span> : <span className="badge badge--met">자동 적용</span>}</div>
                </div>
              ))}
            </div>
            {out.dropped_quotes ? <p className="small muted">원문과 맞지 않아 버린 인용 {out.dropped_quotes}개</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const { data, loading } = useApi<{ proposals: Proposal[] }>(`/api/projects/${projectId}/proposals`);
  const open = (data?.proposals ?? []).filter((p) => p.locked_at && p.status !== "received");
  const [sel, setSel] = useState(params.get("proposal") ?? "");
  useEffect(() => { if (!sel && open[0]) setSel(open[0].id); }, [sel, open]);
  const proposal = open.find((p) => p.id === sel);
  const [tv, setTv] = useState(0);
  const [result, setResult] = useState<{ verdict: { judged: boolean; reason?: string; verdict?: { result: string; successes: number; n: number } }; evidence: { quality_flags: string[]; evidence_level: string } } | null>(null);

  if (loading) return <Loading />;
  return (
    <>
      <section className="section">
        <div className="section__head">
          <div>
            <h2>결과 제출</h2>
            <p>결과를 낼지 말지는 팀이 정합니다. 서비스는 독촉하지 않습니다.</p>
          </div>
          {open.length > 1 ? (
            <select className="select" style={{ width: "auto" }} aria-label="제안 고르기" value={sel} onChange={(e) => { setSel(e.target.value); setResult(null); }}>
              {open.map((p) => <option key={p.id} value={p.id}>{p.method}</option>)}
            </select>
          ) : null}
        </div>
        {result ? (
          <div className="panel">
            <h3>제출했습니다</h3>
            <p style={{ margin: "0 0 10px" }}>
              증거 수준 <EvidenceLadder level={result.evidence.evidence_level} />
              {result.verdict.judged && result.verdict.verdict ? <> 판정 <VerdictBadge result={result.verdict.verdict.result} /> <span className="num">{result.verdict.verdict.successes}/{result.verdict.verdict.n}</span></> : <> 판정하지 않음: {result.verdict.reason}</>}
            </p>
            {result.evidence.quality_flags.length ? <Note tone="warn">{result.evidence.quality_flags.map((f) => <p key={f}>{f}</p>)}</Note> : null}
            <div className="form-actions">
              <button className="pill pill--ink" onClick={() => router.push(`/projects/${projectId}/verdicts?proposal=${proposal?.id ?? sel}`)}>판정 자세히 보기</button>
            </div>
          </div>
        ) : !canEdit ? <ReadOnlyHint /> : proposal ? (
          <SubmitForm key={proposal.id} projectId={projectId} proposal={proposal} onDone={(r) => setResult(r as typeof result)} />
        ) : (
          <Empty title="결과를 기다리는 제안이 없습니다" action={<Link className="pill pill--ink" href={`/projects/${projectId}/proposals`}>검증 제안 보기</Link>}>
            기획서의 기준을 잠근 제안만 결과를 받을 수 있습니다.
          </Empty>
        )}
      </section>
      {canEdit ? <Transcript projectId={projectId} onDone={() => setTv((v) => v + 1)} /> : null}
      {canEdit ? <InsightReview projectId={projectId} version={tv} /> : null}
    </>
  );
}

function ResultsStage({ projectId, name }: { projectId: string; name: string }) {
  const { data } = useApi<{ proposals: Proposal[] }>(`/api/projects/${projectId}/proposals`);
  const ps = data?.proposals ?? [];
  const waiting = ps.filter((p) => p.locked_at && p.status !== "received").length;
  const got = ps.filter((p) => p.status === "received").length;
  return (
    <Stage short crumb={<><b>결과 수령</b>{name}</>} seed={6}>
      <TiltCard title="돌아온 결과" sub="원자료는 이름, 연락처, 회사명을 가명으로 바꾼 뒤 저장합니다. 가명과 원래 값을 잇는 표는 따로 보관합니다.">
        <Ring value={waiting} max={Math.max(ps.length, 1)} display={String(waiting)} unit="건" label="기다리는 중" tone="yellow" />
        <Ring value={got} max={Math.max(ps.length, 1)} display={String(got)} unit="건" label="받음" tone="teal" />
      </TiltCard>
    </Stage>
  );
}

export default function ResultsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <ResultsStage projectId={projectId} name={projectName(info?.project.name)} />}>
      <Suspense><Body projectId={projectId} /></Suspense>
    </ProjectShell>
  );
}
