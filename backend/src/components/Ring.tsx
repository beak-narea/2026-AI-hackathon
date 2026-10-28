// 원형 게이지. 값은 서버가 계산한 것만 넣는다 (확률, 비율, 진행). AI 점수에는 쓰지 않는다.
export type RingTone = "teal" | "coral" | "yellow" | "cyan" | "stone";

const TONE: Record<RingTone, string> = {
  teal: "var(--teal)", coral: "var(--coral)", yellow: "var(--yellow)", cyan: "var(--cyan)", stone: "var(--stone)",
};

export function Ring({
  value, max = 1, display, unit, label, tone = "cyan", light = false,
}: {
  /** 0~max */
  value: number | null;
  max?: number;
  /** 가운데 큰 글자 (기본: 백분율) */
  display?: string;
  unit?: string;
  label: string;
  tone?: RingTone;
  light?: boolean;
}) {
  const r = 27;
  const c = 2 * Math.PI * r;
  const frac = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const big = display ?? (value === null ? "–" : String(Math.round((value / max) * 100)));
  const u = unit ?? (display === undefined && value !== null ? "%" : "");
  return (
    <div className={`ring${light ? " light" : ""}`} role="img" aria-label={`${label} ${big}${u}`}>
      <svg viewBox="0 0 64 64" style={{ color: light ? "#000" : "#fff" }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke={light ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.18)"} strokeWidth="3" />
        <circle
          cx="32" cy="32" r={r} fill="none" stroke={light && tone === "stone" ? "#000" : TONE[tone]} strokeWidth={light ? 4 : 3} strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 32 32)"
        />
        <text x="32" y="38" textAnchor="middle">
          <tspan className="ring__value">{big}</tspan>
          {u ? <tspan className="ring__unit" dx="1">{u}</tspan> : null}
        </text>
      </svg>
      <span className="ring__label">{label}</span>
    </div>
  );
}
