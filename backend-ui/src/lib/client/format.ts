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

