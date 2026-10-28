// 인용 검증: 모든 인사이트에 원문 발언을 1개 이상 달고, 전사본과 문자열을 대조해 원문에 없는 인용은 버린다 (통과 기준 100%).

function normalize(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[“”"「」『』]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface InsightWithQuotes {
  text: string;
  code_type: string;
  is_interpretive: boolean;
  quotes: string[];
}

export interface VerifiedInsights<T extends InsightWithQuotes> {
  kept: T[];
  droppedQuotes: number;
  droppedInsights: number;
}

export function verifyQuotes<T extends InsightWithQuotes>(transcript: string, insights: T[]): VerifiedInsights<T> {
  const haystack = normalize(transcript);
  let droppedQuotes = 0;
  let droppedInsights = 0;
  const kept: T[] = [];
  for (const insight of insights) {
    const quotes = insight.quotes.filter((q) => {
      const n = normalize(q);
      const ok = n.length >= 2 && haystack.includes(n);
      if (!ok) droppedQuotes++;
      return ok;
    });
    if (quotes.length === 0) {
      droppedInsights++;
      continue;
    }
    kept.push({ ...insight, quotes });
  }
  return { kept, droppedQuotes, droppedInsights };
}
