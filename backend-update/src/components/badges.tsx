// 상태 표시 컴포넌트. variant 값은 DB enum과 같다.
import { LABEL_KO, EVIDENCE_LEVELS, type EvidenceLevel } from "@/lib/domain/rules";

export const VERDICT_KO: Record<string, string> = LABEL_KO.verdict;

export function VerdictBadge({ result }: { result: string | null | undefined }) {
  if (!result) return <span className="badge">판정 전</span>;
  return (
    <span className={`badge badge--${result}`}>
      <span className="badge__dot" />
      {VERDICT_KO[result] ?? result}
    </span>
  );
}

const STATUS_KO: Record<string, [string, string]> = {
  unverified: ["미검증", ""],
  in_progress: ["검증 중", "info"],
  met: ["충족", "met"],
  not_met: ["미달", "not_met"],
  on_hold: ["판정 보류", "on_hold"],
  needs_recheck: ["재검증 필요", "not_met"],
};

export function HypothesisStatus({ status }: { status: string }) {
  const [label, tone] = STATUS_KO[status] ?? [status, ""];
  return <span className={`badge${tone ? ` badge--${tone}` : ""}`}>{label}</span>;
}

export function CriticalityTag({ level }: { level: string | null | undefined }) {
  if (!level) return <span className="badge">중요도 미정</span>;
  return <span className={`badge badge--${level}`}>{LABEL_KO.criticality[level as keyof typeof LABEL_KO.criticality] ?? level}</span>;
}

export function EvidenceLadder({ level, onStage = false }: { level: EvidenceLevel | string; onStage?: boolean }) {
  const idx = EVIDENCE_LEVELS.indexOf(level as EvidenceLevel);
  const name = LABEL_KO.evidence[level as EvidenceLevel] ?? "";
  return (
    <span className={`ladder${idx < 2 ? " ladder--weak" : ""}${onStage ? " on-stage" : ""}`} title="증거 수준: 고객이 무엇을 걸었는가">
      <span className="ladder__steps" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} className={i <= idx ? "on" : ""} />
        ))}
      </span>
      {level} {name}
    </span>
  );
}

const ZONE_TONE: Record<string, string> = { green: "met", red: "not_met", rnd: "info", low: "no_conclusion" };
export function ZoneChip({ zone, provisional }: { zone: string | null; provisional?: boolean }) {
  if (!zone) return <span className="badge">구역 미확인</span>;
  return (
    <span className={`badge badge--${ZONE_TONE[zone]}`}>
      {LABEL_KO.zone[zone as keyof typeof LABEL_KO.zone]}
      {provisional ? " (잠정)" : ""}
    </span>
  );
}

const RISK: Record<string, [string, string]> = { high: ["대체 위험 높음", "not_met"], mid: ["대체 위험 중간", "on_hold"], low: ["대체 위험 낮음", "met"] };
export function RiskLevel({ level }: { level: string | null }) {
  if (!level) return <span className="badge">대체 위험 미확인</span>;
  const [l, t] = RISK[level]!;
  return <span className={`badge badge--${t}`}>{l}</span>;
}

const PROPOSAL: Record<string, [string, string]> = {
  draft: ["작성 중", ""], sent: ["전달", "info"], awaiting: ["결과 대기", "on_hold"], received: ["결과 수령", "met"],
};
export function ProposalStatus({ status }: { status: string }) {
  const [l, t] = PROPOSAL[status] ?? [status, ""];
  return <span className={`badge${t ? ` badge--${t}` : ""}`}>{l}</span>;
}

const CONN: Record<string, [string, string]> = { connected: ["연결됨", "met"], error: ["오류", "not_met"], disconnected: ["끊김", ""] };
export function ConnectionStatus({ status }: { status: string }) {
  const [l, t] = CONN[status] ?? [status, ""];
  return <span className={`badge${t ? ` badge--${t}` : ""}`}>{l}</span>;
}

export const DECISION_KO = LABEL_KO.decision as Record<string, string>;
export const TYPE_KO: Record<string, string> = {
  trust: "결과물 신뢰", accuracy: "기대 정확도", data: "데이터 확보", demand: "자동화 수요",
  preference: "자동화 선호", feasibility: "기술 가능성", payment: "지불 의향", other: "기타",
};
