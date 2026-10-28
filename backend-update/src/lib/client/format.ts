export const projectName = (name: string | undefined | null) => (name ?? "").replace(/^예시 · /, "");
export const firstSentence = (s: string | undefined | null, max = 90) => {
  const t = (s ?? "").split(/(?<=[.!?。])\s|\n/)[0] ?? "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
