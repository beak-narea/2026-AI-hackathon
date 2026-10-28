export const projectName = (name: string | undefined | null) => (name ?? "").replace(/^예시 · /, "");
export const firstSentence = (s: string | undefined | null, max = 90) => {
  const t = (s ?? "").split(/(?<=[.!?。])\s|\n/)[0] ?? "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** 로그인 뒤 돌아갈 주소: 이 사이트 안의 경로만 (//다른사이트, /\다른사이트, javascript: 막기) */
export function safeNext(raw: string | null | undefined, fallback = "/projects"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, "https://x.invalid");
    if (u.origin !== "https://x.invalid") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}


/** 사업 모델 칸 이름 (가설이 어느 칸에서 나왔는지 표시할 때) */
export const CANVAS_KO: Record<string, string> = {
  problem: "문제", customer_segments: "고객", unique_value_proposition: "가치 제안", solution: "해결책", channels: "채널",
  revenue_streams: "수익", cost_structure: "비용 구조", key_metrics: "핵심 지표", unfair_advantage: "경쟁 우위",
};

/** 가설을 고르는 목록에 쓸 이름: "[문제] 문장" */
export const hypothesisLabel = (h: { statement: string; source_field?: string | null }) =>
  h.source_field && CANVAS_KO[h.source_field] ? `[${CANVAS_KO[h.source_field]}] ${h.statement}` : h.statement;

/** 조사 '으로/로': 받침이 있으면 '으로', 없거나 ㄹ 받침이면 '로'. 끝의 괄호 설명은 건너뛰고 본다 */
export function withRo(word: string): string {
  const core = word.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const last = core.slice(-1);
  let ro = "로";
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) {
    const jong = code % 28;
    ro = jong === 0 || jong === 8 ? "로" : "으로";
  } else if (/[0-9]/.test(last)) {
    ro = "36".includes(last) ? "으로" : "로"; // 삼·육은 받침이 있다 (0 영도 받침이지만 '영으로'가 자연스럽다)
    if (last === "0") ro = "으로";
  }
  return `${word}${ro}`;
}

/** 조사만: roOf("실사용 지표") → "로" */
export const roOf = (word: string) => withRo(word).slice(word.length);
