"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ProjectShell, ReadOnlyHint, useProject } from "@/components/ProjectShell";
import { Stage, TiltCard } from "@/components/Stage";
import { Ring } from "@/components/Ring";
import { EvidenceLadder, RiskLevel, VerdictBadge, ZoneChip } from "@/components/badges";
import { api, emitChange, pct, useAction, useApi, useOnChange } from "@/lib/client/api";
import { Empty, ErrorNote, Field, Loading, Note, Segmented, toast } from "@/components/ui";
import { projectName } from "@/lib/client/format";
import { LEVEL_TO_STATUS, LevelChip, LevelPicker, STATUS_TO_LEVEL, LEVELS } from "@/components/levels";

// 항목마다 "이 업무를 지켜 주는 요인" (근거가 충분할수록 범용 AI로 대체될 위험이 낮다)
const GUARDS: Record<string, string> = {
  proprietary_data: "남이 갖지 못한 데이터가 쌓이거나 이미 있다",
  integration_depth: "고객의 기존 시스템 깊숙이 연결돼 빼기 어렵다",
  human_expertise: "사람 검수나 전문 지식이 결과 품질을 지킨다",
  switching_cost: "고객이 다른 도구로 옮기기 어렵다",
  regulatory_barrier: "규제·인증이 새 경쟁자를 막는다",
  bigtech_overlap: "빅테크가 공개한 계획과 겹치지 않는다",
};

/** 예전 초안은 "근거\n확인 방법: …" 한 칸이었다 */
function splitNote(note: string, gap?: string): { found: string; gap: string } {
  if (gap) return { found: note, gap };
  const [a, b] = note.split("\n확인 방법: ");
  return { found: /^\s*자료에 없음/.test(a ?? "") ? "" : (a ?? ""), gap: b ?? "" };
}

const ITEMS: Record<string, string> = {
  proprietary_data: "독점·축적 데이터",
  integration_depth: "고객 시스템 연동 깊이",
  human_expertise: "사람 검수·전문 지식",
  switching_cost: "전환 비용",
  regulatory_barrier: "규제·인증 장벽",
  bigtech_overlap: "빅테크 공개 로드맵과의 겹침",
};
const AGENCY = ["H1", "H2", "H3", "H4", "H5"] as const;
const AGENCY_KO: Record<string, string> = { H1: "완전 자동", H2: "AI 주도", H3: "함께", H4: "사람 주도", H5: "사람만" };

interface Diagnosis {
  id: string; zone: string | null; is_provisional: boolean; feasibility_level: string; demand_level: string;
  feasibility_verdict: string | null; demand_verdict: string | null; buyer_demand_verdict: string | null; buyer_demand_level: string;
  demand_prior: number | null; demand_prior_task: string | null; agency_assumed: string | null; agency_observed: string | null;
  baseline_win_rate: number | null; baseline_result: string | null; wrapper_risk: string | null; confirmation_questions: string[];
  tasks: { name: string; role: string } | null;
  wrapper_items: Array<{ id: string; item_key: string; status: "yes" | "no" | "unknown"; evidence_note: string; gap?: string }>;
  baseline_tests: Array<{ id: string; model: string; created_at: string }>;
}

function DiagnosisPanel({ projectId, d, reload }: { projectId: string; d: Diagnosis; reload: () => Promise<void> }) {
  const { canEdit } = useProject();
  const [suggest, setSuggest] = useState<string[]>([]);
  const update = useAction(async (patch: Record<string, unknown>) => {
    const r = await api<{ suggestions: string[] }>(`/api/projects/${projectId}/diagnoses/${d.id}`, { method: "PATCH", body: patch });
    setSuggest(r.suggestions);
    await reload();
  });
  const result = useAction(async (testId: string) => {
    // 판정을 진단에 반영한다 (편집자만, 서버가 다시 확인)
    const r = await api<{ result: string; oursWins: number; samples: number; evaluators: number }>(`/api/projects/${projectId}/baseline-tests/${testId}/result`, { method: "POST" });
    toast(`기준선 테스트: ${r.samples}개 샘플 중 ${r.oursWins}개에서 자사 결과가 앞섰습니다`);
    await reload();
  });

  return (
    <article className="panel" style={{ marginBottom: 16 }}>
      <div className="section__head" style={{ marginBottom: 8 }}>
        <div>
          <h3>{d.tasks?.name ?? "업무"}</h3>
          <div className="row__meta">
            <ZoneChip zone={d.zone} provisional={d.is_provisional} />
            <RiskLevel level={d.wrapper_risk} />
            <span>가능성 <EvidenceLadder level={d.feasibility_level} /></span>
            <span>수요 <EvidenceLadder level={d.demand_level} /></span>
          </div>
        </div>
      </div>
      <div className="table-wrap" style={{ marginTop: 6 }}>
        <table className="t">
          <thead><tr><th>축</th><th>판정</th><th>증거</th></tr></thead>
          <tbody>
            <tr><td>기술 가능성</td><td><VerdictBadge result={d.feasibility_verdict ?? d.baseline_result} /></td><td><EvidenceLadder level={d.feasibility_level} /></td></tr>
            <tr><td>수요 (업무를 하는 사람)</td><td><VerdictBadge result={d.demand_verdict} /></td><td><EvidenceLadder level={d.demand_level} /></td></tr>
            <tr><td>수요 (돈을 내는 사람)</td><td><VerdictBadge result={d.buyer_demand_verdict} /></td><td><EvidenceLadder level={d.buyer_demand_level} /></td></tr>
          </tbody>
        </table>
      </div>
      {d.demand_verdict && d.buyer_demand_verdict && ((d.demand_verdict === "met" && d.buyer_demand_verdict === "not_met") || (d.demand_verdict === "not_met" && d.buyer_demand_verdict === "met")) ? (
        <Note tone="warn"><p>업무를 하는 사람과 돈을 내는 사람의 수요가 엇갈립니다. 두 사람에게 다른 가치 제안이 필요할 수 있습니다.</p></Note>
      ) : null}

      <div className="grid2" style={{ marginTop: 14 }}>
        <div>
          <h4 style={{ margin: "0 0 8px" }}>확인할 질문</h4>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.confirmation_questions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
          {d.demand_prior !== null ? (
            <p className="small muted" style={{ marginTop: 10 }}>
              참고: WORKBank 유사 업무의 자동화 희망 {d.demand_prior.toFixed(1)}/5 ({d.demand_prior_task})
            </p>
          ) : null}
        </div>
        <div>
          <h4 style={{ margin: "0 0 8px" }}>완전 자동화와 사람 보조</h4>
          <p className="small muted" style={{ margin: "0 0 6px" }}>제품이 가정한 단계</p>
          {canEdit ? (
            <Segmented label="제품이 가정한 단계" value={(d.agency_assumed ?? "") as string} onChange={(v) => void update.run({ agency_assumed: v })}
              options={AGENCY.map((a) => ({ value: a, label: AGENCY_KO[a]! }))} />
          ) : <span className="badge">{d.agency_assumed ? AGENCY_KO[d.agency_assumed] : "미정"}</span>}
          <p className="small muted" style={{ margin: "10px 0 6px" }}>고객이 실제로 고른 단계 (가짜 버튼 2종 결과)</p>
          {canEdit ? (
            <Segmented label="고객이 고른 단계" value={(d.agency_observed ?? "") as string} onChange={(v) => void update.run({ agency_observed: v })}
              options={AGENCY.map((a) => ({ value: a, label: AGENCY_KO[a]! }))} />
          ) : <span className="badge">{d.agency_observed ? AGENCY_KO[d.agency_observed] : "미확인"}</span>}
        </div>
      </div>
      {suggest.map((s) => <Note key={s} tone="info"><p>{s}</p></Note>)}

      <h4 style={{ margin: "20px 0 8px" }}>대체 위험 체크리스트</h4>
      <div className="lvl-filter" aria-label="단계별 개수">
        {LEVELS.map((l) => (
          <span key={l} className="lvl-count"><LevelChip level={l} /> <b>{d.wrapper_items.filter((w) => STATUS_TO_LEVEL[w.status] === l).length}</b></span>
        ))}
      </div>
      <div className="checks">
        {d.wrapper_items.map((w) => {
          const level = STATUS_TO_LEVEL[w.status];
          const note = splitNote(w.evidence_note, w.gap);
          return (
            <article key={w.id} className={`hcheck hcheck--${level}`}>
              <header>
                <span className="hcheck__field">{ITEMS[w.item_key]}</span>
                {canEdit ? null : <LevelChip level={level} />}
              </header>
              <h3>{GUARDS[w.item_key]}</h3>
              {note.found ? <p><span className="hcheck__k">자료에서 찾은 것</span>{note.found}</p> : null}
              {level !== "enough" && note.gap ? <p><span className="hcheck__k">{level === "missing" ? "없는 것·확인 방법" : "부족한 것·확인 방법"}</span>{note.gap}</p> : null}
              {canEdit ? (
                <LevelPicker label={ITEMS[w.item_key]!} value={level} disabled={update.busy}
                  onChange={(v) => void update.run({ wrapper_items: [{ item_key: w.item_key, status: LEVEL_TO_STATUS[v] }] })} />
              ) : null}
            </article>
          );
        })}
      </div>

      <h4 style={{ margin: "20px 0 8px" }}>블라인드 기준선 테스트</h4>
      {d.baseline_result ? (
        <p>
          <VerdictBadge result={d.baseline_result} /> 자사 결과를 더 낫다고 고른 샘플 비율 <span className="num">{pct(d.baseline_win_rate)}</span> (목표 70%, 최소 50%)
        </p>
      ) : <p className="small muted">아직 결과가 없습니다.</p>}
      {canEdit ? d.baseline_tests.map((t) => (
        <div key={t.id} className="form-actions">
          <button className="pill pill--sm" disabled={result.busy} onClick={() => void result.run(t.id)}>평가 모아 판정하기</button>
        </div>
      )) : null}
      <ErrorNote error={update.error ?? result.error} />
      {canEdit ? <BaselineForm projectId={projectId} diagnosisId={d.id} onDone={reload} /> : null}
    </article>
  );
}

function BaselineForm({ projectId, diagnosisId, onDone }: { projectId: string; diagnosisId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [raw, setRaw] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const samples = raw
    .split("\n")
    .map((l) => l.split("|||").map((x) => x.trim()))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([input, ours]) => ({ input: input!, ours: ours! }));
  const start = useAction(async () => {
    const r = await api<{ evaluator_url: string }>(`/api/projects/${projectId}/baseline-tests`, {
      body: { diagnosis_id: diagnosisId, instruction, samples },
    });
    setLink(r.evaluator_url);
    await onDone();
  });
  if (!open) return <button className="pill pill--sm" onClick={() => setOpen(true)}>새 기준선 테스트</button>;
  return (
    <div className="panel panel--soft" style={{ marginTop: 10 }}>
      <Field label="범용 모델에 줄 지시"><input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="예: 다음 증빙을 계정과목으로 분류하라" /></Field>
      <Field label={`샘플 (한 줄에 하나: 입력 ||| 자사 결과) ${samples.length}개`}>
        <textarea className="textarea" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </Field>
      <ErrorNote error={start.error} />
      {link ? <Note tone="good"><p>평가자에게 이 주소를 보내세요: <a href={link}>{link}</a></p></Note> : null}
      <button className="pill pill--ink" disabled={start.busy || samples.length < 10 || instruction.length < 5} onClick={() => void start.run()}>
        {start.busy ? "범용 모델 결과 만드는 중" : "평가 링크 만들기"}
      </button>
    </div>
  );
}

interface CostModel { inputs: Record<string, number>; results: { costPerTask: { model: number; review: number; total: number }; margin: number; scenarios: Array<{ scenario: string; label: string; topShare: number; heavyMultiplier: number; avgMargin: number; heavyMargin: number; heavyLoses: boolean; avgMarginRate: number | null }>; sensitivity: Array<{ case: string; label: string; breakevenPrice: number; heavyBreakevenPrice: number }> } }

const COST_FIELDS: Array<[string, string, string]> = [
  ["tasksPerUser", "사용자당 월 작업 수", "건"], ["callsPerTask", "작업당 모델 호출 수", "회"], ["inputTokens", "호출당 입력 토큰", ""],
  ["outputTokens", "호출당 출력 토큰", ""], ["cacheSaving", "캐시 절감률 (0~1)", ""], ["retryRate", "재시도율 (0~1)", ""],
  ["reviewHoursPerTask", "작업당 사람 검수 시간", "시간"], ["hourlyWage", "검수 시급", "원"], ["monthlyPrice", "사용자당 월 가격", "원"],
];
const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;

function CostPanel({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const { data, reload } = useApi<{ cost_model: CostModel | null }>(`/api/projects/${projectId}/cost-model`);
  const prices = useApi<{ models: Array<{ model_name: string; updated_at: string }> }>(`/api/price-table`);
  const cm = data?.cost_model;
  const [form, setForm] = useState<Record<string, string>>({});
  const [model, setModel] = useState("");
  const val = (k: string) => form[k] ?? (cm?.inputs[k] !== undefined ? String(cm.inputs[k]) : "");
  const calc = useAction(async () => {
    const body: Record<string, unknown> = { model_name: model || undefined };
    // 단가표 모델을 고르지 않았으면 직접 넣은 단가도 보낸다
    const keys = [...COST_FIELDS.map(([k]) => k), ...(model ? [] : ["inputPricePerMTok", "outputPricePerMTok"])];
    for (const k of keys) {
      if (val(k) === "") continue;
      const n = Number(val(k));
      if (!Number.isFinite(n)) throw new Error(`숫자가 아닌 값이 있습니다: ${val(k)}`);
      body[k] = n;
    }
    if (!model && (body.inputPricePerMTok === undefined || body.outputPricePerMTok === undefined)) {
      throw new Error("모델 단가표에서 고르거나 입력·출력 단가를 넣어 주세요");
    }
    await api(`/api/projects/${projectId}/cost-model`, { body });
    setForm({});
    await reload();
    emitChange("diagnosis");
  });
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>AI 운영비</h2>
        </div>
      </div>
      {cm ? (
        <>
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table className="t">
              <thead><tr><th>사용량 분포</th><th>상위 10% 사용량</th><th>평균 사용자 마진</th><th>상위 10% 사용자 1명 마진</th></tr></thead>
              <tbody>
                {cm.results.scenarios.map((s) => (
                  <tr key={s.scenario}>
                    <td>{s.label}</td>
                    <td className="num">평균의 {s.heavyMultiplier.toFixed(1)}배</td>
                    <td className="num">{won(s.avgMargin)} ({pct(s.avgMarginRate)})</td>
                    <td className={s.heavyLoses ? "not_met num" : "num"}>{won(s.heavyMargin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>상황</th><th>손익분기 월 가격 (평균)</th><th>손익분기 월 가격 (상위 10%)</th></tr></thead>
              <tbody>
                {cm.results.sensitivity.map((s) => (
                  <tr key={s.case}><td>{s.label}</td><td className="num">{won(s.breakevenPrice)}</td><td className="num">{won(s.heavyBreakevenPrice)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <p className="muted">아직 계산하지 않았습니다.</p>}
      {canEdit ? (
        <details className="panel panel--soft" style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>입력값 바꿔 다시 계산</summary>
          <div style={{ marginTop: 14 }}>
            <Field label="모델 단가표에서 고르기">
              <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">직접 입력</option>
                {(prices.data?.models ?? []).map((m) => <option key={m.model_name} value={m.model_name}>{m.model_name}</option>)}
              </select>
            </Field>
            {!model ? (
              <div className="grid2">
                <Field label="입력 100만 토큰당 가격 (원)"><input className="input" inputMode="decimal" value={val("inputPricePerMTok")} onChange={(e) => setForm({ ...form, inputPricePerMTok: e.target.value })} /></Field>
                <Field label="출력 100만 토큰당 가격 (원)"><input className="input" inputMode="decimal" value={val("outputPricePerMTok")} onChange={(e) => setForm({ ...form, outputPricePerMTok: e.target.value })} /></Field>
              </div>
            ) : null}
            <div className="grid3">
              {COST_FIELDS.map(([k, l]) => (
                <Field key={k} label={l}><input className="input" inputMode="decimal" value={val(k)} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
              ))}
            </div>
            <ErrorNote error={calc.error} />
            <button className="pill pill--ink" disabled={calc.busy} onClick={() => void calc.run()}>계산</button>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Body({ projectId }: { projectId: string }) {
  const { canEdit } = useProject();
  const { data, loading, error, reload: reloadOwn } = useApi<{ diagnoses: Diagnosis[] }>(`/api/projects/${projectId}/diagnoses`);
  const reload = async () => {
    await reloadOwn();
    emitChange("diagnosis");
  };
  const run = useAction(async () => {
    await api(`/api/projects/${projectId}/diagnoses/run`, { method: "POST" });
    await reload();
  });
  if (loading) return <Loading lines={6} />;
  return (
    <>
      <ErrorNote error={error ?? run.error} />
      <section className="section">
        <div className="section__head">
          <div>
            <h2>업무별 진단</h2>
          </div>
          {canEdit ? <button className="pill pill--ink" disabled={run.busy} onClick={() => void run.run()}>{run.busy ? "진단하는 중" : "최신 사업 모델로 진단"}</button> : null}
        </div>
        {(data?.diagnoses ?? []).length === 0 ? (
          <Empty title="아직 진단이 없습니다" />
        ) : data!.diagnoses.map((d) => <DiagnosisPanel key={d.id} projectId={projectId} d={d} reload={reload} />)}
      </section>
      <CostPanel projectId={projectId} />
      <ReadOnlyHint />
    </>
  );
}

function DiagStage({ projectId, name }: { projectId: string; name: string }) {
  const { data, reload } = useApi<{ diagnoses: Diagnosis[] }>(`/api/projects/${projectId}/diagnoses`);
  const cost = useApi<{ cost_model: CostModel | null }>(`/api/projects/${projectId}/cost-model`);
  useOnChange("diagnosis", reload);
  useOnChange("diagnosis", cost.reload);
  const d = data?.diagnoses[0];
  const s = cost.data?.cost_model?.results.scenarios.find((x) => x.scenario === "observed");
  const price = cost.data?.cost_model?.inputs.monthlyPrice;
  const heavyRate = s && price ? s.heavyMargin / price : null;
  return (
    <Stage crumb={<><b>아이디어 정리 · 진단</b>{name}</>} seed={2} aside={d ? <span className="stage__note"><ZoneChip zone={d.zone} provisional={d.is_provisional} /></span> : null}>
      <TiltCard kicker="진단한 업무" title={d?.tasks?.name ?? "아직 진단 전"}>
        <Ring value={d?.baseline_win_rate ?? null} label="기준선에서 자사가 앞선 비율" tone="teal" />
        <Ring value={d?.demand_prior ?? null} max={5} display={d?.demand_prior?.toFixed(1) ?? "–"} unit="/5" label="참고: 자동화 희망" tone="stone" />
        <Ring value={s?.avgMarginRate ?? null} label="평균 사용자 마진율" tone="cyan" />
        <Ring value={heavyRate === null ? null : Math.max(0, heavyRate)} display={heavyRate === null ? undefined : String(Math.round(heavyRate * 100))}
          unit="%" label="많이 쓰는 사용자 마진율" tone={heavyRate !== null && heavyRate < 0 ? "coral" : "teal"} />
      </TiltCard>
    </Stage>
  );
}

export default function DiagnosisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <ProjectShell projectId={projectId} stage={(info) => <DiagStage projectId={projectId} name={projectName(info?.project.name)} />}>
      <Body projectId={projectId} />
    </ProjectShell>
  );
}
