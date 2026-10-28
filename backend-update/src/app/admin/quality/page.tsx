"use client";
import { pct, useApi } from "@/lib/client/api";
import { ErrorNote, Loading, Note } from "@/components/ui";

interface Rate { k: number; n: number; rate: number | null; ci: [number, number] | null }
interface Report {
  projects: number;
  criticality_scale: { alpha: number | null; units: number; raters: number; required_units: number; status: string };
  predictive_validity: { critical: Rate; major: Rate; minor: Rate };
  llm_devils_advocate: { flagged: Rate; others: Rate };
  wrapper_grade: { high: Rate; mid: Rate; low: Rate };
  execution_fidelity: { method_same: Rate; notice_compliance: Rate };
  example_effect: { viewed: Rate; not_viewed: Rate };
  cycles_in_8_weeks: { projects: number; mean: number | null; at_least_3: Rate; in_progress: number };
  submission_rate: Rate;
}

const R = ({ r }: { r: Rate }) => (
  <span className="num">{r.n ? `${pct(r.rate)} (${r.k}/${r.n})` : "–"}{r.ci && r.n ? <span className="small muted"> 95% {pct(r.ci[0])}~{pct(r.ci[1])}</span> : null}</span>
);

export default function Quality() {
  const { data, loading, error } = useApi<Report>("/api/admin/quality");
  if (loading) return <Loading lines={6} />;
  if (error || !data) return <ErrorNote error={error} />;
  const c = data.criticality_scale;
  return (
    <>
      <Note tone="info"><p>서비스 전체에 쌓인 기록으로 봅니다 (예시 제외 프로젝트 {data.projects}개). 표본이 작을 때는 방향만 참고하고, 결론은 쌓인 뒤에 냅니다.</p></Note>
      <section className="section">
        <div className="section__head"><div><h2>중요도 척도</h2><p>프로젝트별로 쓰지 않고 척도 자체의 신뢰도를 주기적으로 점검합니다. 0.667 미만이면 앵커 정의를 고칩니다.</p></div></div>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              <tr><td>Krippendorff α (순서, 사람 평정만)</td><td className="num">{c.alpha === null ? "–" : c.alpha.toFixed(3)}</td></tr>
              <tr><td>평정 대상 / 필요</td><td className="num">{c.units} / {c.required_units} (평정자 {c.raters}명)</td></tr>
              <tr><td>상태</td><td>{c.status}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="section">
        <div className="section__head"><div><h2>예측 타당도</h2><p>매긴 중요도별로 이후 실제 미달 비율. 치명과 경미 사이에 차이가 없으면 앵커를 고칩니다.</p></div></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>중요도</th><th>이후 미달 비율</th></tr></thead>
            <tbody>
              <tr><td>치명</td><td><R r={data.predictive_validity.critical} /></td></tr>
              <tr><td>중대</td><td><R r={data.predictive_validity.major} /></td></tr>
              <tr><td>경미</td><td><R r={data.predictive_validity.minor} /></td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="section">
        <div className="section__head"><div><h2>검증되지 않은 설계 가정</h2><p>논리로만 정한 설계를 운영 기록으로 확인합니다.</p></div></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>가정</th><th>재는 것</th><th>값</th></tr></thead>
            <tbody>
              <tr><td>AX 프로세스가 없는 팀도 가이드만으로 실험을 제대로 돌린다</td><td>제안과 같은 방법 비율</td><td><R r={data.execution_fidelity.method_same} /></td></tr>
              <tr><td></td><td>운영 수칙(고지) 준수율</td><td><R r={data.execution_fidelity.notice_compliance} /></td></tr>
              <tr><td>예시 프로젝트가 결과 전 이탈을 줄인다</td><td>첫 검증 제안 채택률: 예시를 본 사람</td><td><R r={data.example_effect.viewed} /></td></tr>
              <tr><td></td><td>예시를 안 본 사람</td><td><R r={data.example_effect.not_viewed} /></td></tr>
              <tr><td>LLM 반대 평가자가 사람이 놓친 위험을 찾는다</td><td>&ldquo;재검토&rdquo; 표시 항목의 이후 미달률</td><td><R r={data.llm_devils_advocate.flagged} /></td></tr>
              <tr><td></td><td>나머지 항목</td><td><R r={data.llm_devils_advocate.others} /></td></tr>
              <tr><td>대체 위험 등급이 실제 위험을 가려낸다</td><td>등급 높음의 이후 미달률</td><td><R r={data.wrapper_grade.high} /></td></tr>
              <tr><td></td><td>중간</td><td><R r={data.wrapper_grade.mid} /></td></tr>
              <tr><td></td><td>낮음</td><td><R r={data.wrapper_grade.low} /></td></tr>
              <tr><td>8주 안에 검증 사이클이 3회 이상 돈다</td><td>첫 제안 잠금 뒤 8주 안 결과 수 (평균)</td><td className="num">{data.cycles_in_8_weeks.mean === null ? "–" : data.cycles_in_8_weeks.mean.toFixed(1)} ({data.cycles_in_8_weeks.projects}개 프로젝트, 진행 중 {data.cycles_in_8_weeks.in_progress})</td></tr>
              <tr><td></td><td>3회 이상인 비율</td><td><R r={data.cycles_in_8_weeks.at_least_3} /></td></tr>
              <tr><td>팀이 실제로 실험을 돌린다 (보조 지표)</td><td>기획서를 받은 팀 중 결과를 낸 비율</td><td><R r={data.submission_rate} /></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
