"use client";
import Link from "next/link";
import { useApi } from "@/lib/client/api";
import { ErrorNote, Loading, Note } from "@/components/ui";

interface Overview {
  gate: { versions_hash: string; model: string; passed: boolean; kinds: Array<{ kind: string; passed: boolean; reasons: string[]; ran_at: string | null }> };
  workbank: { tasks: number; embedded: number };
  projects: number;
  pending_mentor_requests: number;
  config: { llm_provider: string; model: string; voyage: boolean; mail: boolean; encryption_key: boolean; cron_secret: boolean; budget_krw: number };
}
const KIND_KO: Record<string, string> = { weakness: "약점 탐지", framing: "표현 바꾸기", pushback: "반박" };

export default function AdminHome() {
  const { data, loading, error } = useApi<Overview>("/api/admin/overview");
  if (loading) return <Loading lines={5} />;
  if (error || !data) return <ErrorNote error={error} />;
  const c = data.config;
  const checks: Array<[boolean, string, string]> = [
    [c.llm_provider === "anthropic", "LLM", c.llm_provider === "anthropic" ? `Anthropic ${c.model}` : "mock (고정 응답)"],
    [c.encryption_key, "연동 암호화 키", c.encryption_key ? "설정됨" : "ENCRYPTION_KEY 없음: 도구 연동 불가"],
    [c.cron_secret, "매일 예약 작업", c.cron_secret ? "CRON_SECRET 설정됨" : "CRON_SECRET 없음: 자동 가져오기·알림·보관 기간 정리가 돌지 않음"],
    [c.mail, "메일 알림", c.mail ? "Resend 설정됨" : "화면 알림만"],
    [c.voyage, "WORKBank 사전값", c.voyage ? "Voyage 설정됨" : "VOYAGE_API_KEY 없음 (판정에는 영향 없음)"],
  ];
  return (
    <>
      <Note tone={data.gate.passed ? "good" : "bad"}>
        <p><strong>배포 전 점검(아첨 점검 3종): {data.gate.passed ? "통과" : "미통과 — 배포하지 않습니다"}</strong> (모델 {data.gate.model}, 지문 {data.gate.versions_hash})</p>
        {data.gate.kinds.map((k) => (
          <p key={k.kind}>{k.passed ? "✓" : "✗"} {KIND_KO[k.kind]}{k.reasons.length ? `: ${k.reasons.join(" / ")}` : ""}</p>
        ))}
        {!data.gate.passed ? <p><Link href="/admin/evals">아첨 점검 화면으로</Link></p> : null}
      </Note>
      <div className="grid3">
        <div className="panel"><h3>프로젝트</h3><p className="num" style={{ fontSize: 34, margin: 0 }}>{data.projects}</p><p className="small" style={{ margin: 0 }}>예시 제외</p></div>
        <div className="panel"><h3>외부 평가자 요청</h3><p className="num" style={{ fontSize: 34, margin: 0 }}>{data.pending_mentor_requests}</p><p className="small" style={{ margin: 0 }}><Link href="/admin/mentors">배정하기</Link></p></div>
        <div className="panel"><h3>WORKBank 업무</h3><p className="num" style={{ fontSize: 34, margin: 0 }}>{data.workbank.embedded}</p><p className="small" style={{ margin: 0 }}>임베딩된 업무 / 전체 {data.workbank.tasks}</p></div>
      </div>
      <section className="section" style={{ marginTop: 28 }}>
        <div className="section__head"><h2>설정</h2></div>
        <div className="rows">
          {checks.map(([ok, label, desc]) => (
            <div className="row" key={label}>
              <div><div className="row__title">{label}</div><div className="row__meta">{desc}</div></div>
              <div className="row__side"><span className={`badge badge--${ok ? "met" : "on_hold"}`}>{ok ? "됨" : "확인"}</span></div>
            </div>
          ))}
          <div className="row">
            <div><div className="row__title">프로젝트당 월 AI 사용 한도</div><div className="row__meta">PROJECT_MONTHLY_LLM_BUDGET_KRW</div></div>
            <div className="row__side num">{c.budget_krw ? `${c.budget_krw.toLocaleString("ko-KR")}원` : "없음"}</div>
          </div>
        </div>
      </section>
      {data.workbank.embedded === 0 ? (
        <Note tone="info">
          <p><strong>WORKBank 수요 사전값을 넣으려면</strong> 서버에서 <code>npm run workbank:import</code>를 한 번 실행합니다 (VOYAGE_API_KEY 필요, Hugging Face에서 자동으로 내려받음).</p>
          <p>출처: Shao et al., &ldquo;Future of Work with AI Agents&rdquo;. 라이선스 표기가 없어 비상업적 용도로만 쓰고, 유료 판매 전에 저자에게 허락을 받습니다.</p>
        </Note>
      ) : null}
    </>
  );
}
