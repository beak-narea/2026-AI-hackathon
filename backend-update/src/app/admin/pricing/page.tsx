"use client";
import { useEffect, useState } from "react";
import { api, useAction, useApi } from "@/lib/client/api";
import { ErrorNote, Field, Loading, Note, toast } from "@/components/ui";

interface Survey {
  id: string; title: string; description: string; share_token: string; open: boolean; responses: number; min_respondents: number;
  result: { respondents: number; pmc: number | null; pme: number | null; opp: number | null; ipp: number | null; enoughRespondents: boolean; excluded: number };
}
type Settings = Record<string, number>;
interface Cost {
  settings: Settings;
  measured: { projects: number; llmCalls: number; baselineTests: number; externalRaterFees: number } | null;
  variable: { llmCalls: number; baselineTests: number; externalRaterFees: number; storage: number; total: number; source: string };
  price_floor: number; monthly_fixed: number; amortization_months: number; breakeven_programs: number | null;
  acceptable_range: { low: number; high: number; respondents: number; enough: boolean } | null; range_below_floor: boolean | null;
}

const won = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v).toLocaleString("ko-KR")}원`);
const COST_FIELDS: Array<[string, string, string?]> = [
  ["price", "검증 프로그램(8주) 가격", "손익분기 계산에 씁니다. 0이면 계산하지 않습니다"],
  ["targetGrossMargin", "목표 매출총이익률 (0~0.95)", "AI 제품 평균 약 52%(ICONIQ, 2026)에서 출발"],
  ["monthlyPeople", "월 인건비 (기획 1, 개발 2, 디자인 0.5)"],
  ["monthlyInfraFixed", "월 인프라 고정분 (호스팅·DB)"],
  ["monthlyCodingCheck", "월 전사본 코딩 표본 점검"],
  ["legalReviewOnce", "법률 검토 (일회성)"],
  ["initialCodingValidationOnce", "코드 유형별 첫 코딩 검증 (일회성 합계)"],
  ["sycophancyCheckPerRun", "아첨 점검 1회 (전문가 시간 + 호출)"],
  ["sycophancyRunsPerYear", "아첨 점검 연간 횟수"],
  ["storagePerProgram", "프로그램당 저장 비용"],
  ["llmPerProgramAssumed", "프로그램당 LLM 비용 가정 (실측이 없을 때)"],
];

function Surveys() {
  const { data, loading, error, reload } = useApi<{ surveys: Survey[] }>("/api/admin/price-surveys");
  const [title, setTitle] = useState("검증 프로그램(8주) 가격");
  const create = useAction(async () => {
    await api("/api/admin/price-surveys", { body: { title } });
    await reload();
  });
  const toggle = useAction(async (s: Survey) => {
    await api(`/api/admin/price-surveys/${s.id}`, { method: "PATCH", body: { open: !s.open } });
    await reload();
  });
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  if (loading) return <Loading />;
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>가격 설문 (Van Westendorp)</h2>
          <p>초기 사용 팀 후보 15명 이상에게 4문항으로 수용 가격 범위를 잡습니다. 진술 증거(L1)라 범위를 정하는 데만 쓰고, 지불은 선결제(L4)로 검증합니다.</p>
        </div>
      </div>
      <ErrorNote error={error ?? toggle.error} />
      {(data?.surveys ?? []).map((s) => (
        <div className="panel" key={s.id} style={{ marginBottom: 14 }}>
          <div className="section__head" style={{ marginBottom: 6 }}>
            <h3>{s.title}</h3>
            <div className="row__side">
              <span className={`badge${s.open ? " badge--met" : ""}`}>{s.open ? "받는 중" : "마감"}</span>
              <button className="pill pill--sm" disabled={toggle.busy} onClick={() => void toggle.run(s)}>{s.open ? "마감" : "다시 열기"}</button>
            </div>
          </div>
          <p className="small" style={{ margin: "0 0 10px", wordBreak: "break-all" }}>
            응답 링크: <a href={`/survey/price/${s.share_token}`} target="_blank" rel="noreferrer">{origin}/survey/price/{s.share_token}</a>
            <button className="pill pill--sm" style={{ marginLeft: 8 }} onClick={() => { void navigator.clipboard?.writeText(`${origin}/survey/price/${s.share_token}`); toast("링크를 복사했습니다"); }}>복사</button>
          </p>
          <dl className="kv">
            <dt>응답</dt><dd className="num">{s.result.respondents}명 {s.result.excluded ? `(순서가 맞지 않아 제외 ${s.result.excluded}명)` : ""} {s.result.enoughRespondents ? "" : `· ${s.min_respondents}명 미만이라 기준 미달`}</dd>
            <dt>수용 범위 (PMC~PME)</dt><dd className="num">{won(s.result.pmc)} ~ {won(s.result.pme)}</dd>
            <dt>최적 가격점 (OPP)</dt><dd className="num">{won(s.result.opp)}</dd>
            <dt>무관심 가격점 (IPP)</dt><dd className="num">{won(s.result.ipp)}</dd>
          </dl>
        </div>
      ))}
      <div className="sub">
        <Field label="새 설문 제목"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <ErrorNote error={create.error} />
        <button className="pill" disabled={create.busy || !title} onClick={() => void create.run()}>설문 만들기</button>
      </div>
    </section>
  );
}

function OurCost() {
  const { data, loading, error, reload } = useApi<Cost>("/api/admin/cost");
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setF(Object.fromEntries(Object.entries(data.settings).map(([k, v]) => [k, String(v)])));
  }, [data]);
  const save = useAction(async () => {
    await api("/api/admin/cost", { method: "PUT", body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v) || 0])) });
    toast("비용 구조를 저장했습니다");
    await reload();
  });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2>우리 서비스의 비용 구조</h2>
          <p>가격 하한 = 변동비 ÷ (1 − 목표 매출총이익률). 손익분기 = 월 고정비 ÷ (가격 − 변동비). 일회성 비용은 {data.amortization_months}개월로 나눕니다.</p>
        </div>
      </div>
      {data.range_below_floor ? (
        <Note tone="bad"><p>가격 설문의 수용 범위({won(data.acceptable_range?.low)}~{won(data.acceptable_range?.high)})가 통째로 가격 하한({won(data.price_floor)})보다 낮습니다. 사람 손이 들어가는 항목(외부 평가자 연결, 수작업 검증)을 줄이거나 판매 단위를 바꿉니다.</p></Note>
      ) : null}
      <div className="grid3">
        <div className="panel"><h3>가격 하한</h3><p className="num" style={{ fontSize: 26, margin: 0 }}>{won(data.price_floor)}</p></div>
        <div className="panel"><h3>월 고정비</h3><p className="num" style={{ fontSize: 26, margin: 0 }}>{won(data.monthly_fixed)}</p></div>
        <div className="panel"><h3>월 손익분기</h3><p className="num" style={{ fontSize: 26, margin: 0 }}>{data.breakeven_programs === null ? (data.settings.price ? "팔수록 손해" : "–") : `${data.breakeven_programs}건`}</p></div>
      </div>
      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="t">
          <thead><tr><th>프로그램당 변동비</th><th>금액</th></tr></thead>
          <tbody>
            <tr><td>LLM 호출 ({data.variable.source}{data.measured ? `, ${data.measured.projects}개 프로젝트` : ""})</td><td className="num">{won(data.variable.llmCalls)}</td></tr>
            <tr><td>기준선 테스트</td><td className="num">{won(data.variable.baselineTests)}</td></tr>
            <tr><td>외부 평가자 연결 수당</td><td className="num">{won(data.variable.externalRaterFees)}</td></tr>
            <tr><td>저장</td><td className="num">{won(data.variable.storage)}</td></tr>
            <tr><td><strong>합계</strong></td><td className="num"><strong>{won(data.variable.total)}</strong></td></tr>
          </tbody>
        </table>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h3>입력값</h3>
        <div className="grid2">
          {COST_FIELDS.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint}><input className="input num" inputMode="decimal" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <ErrorNote error={save.error} />
        <button className="pill pill--ink" disabled={save.busy} onClick={() => void save.run()}>저장하고 다시 계산</button>
      </div>
    </section>
  );
}

export default function Pricing() {
  return (
    <>
      <OurCost />
      <Surveys />
    </>
  );
}
