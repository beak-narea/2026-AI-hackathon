// 결정 사항 7번: Van Westendorp 4문항으로 수용 가능한 가격 범위를 잡는다 (진술 증거, L1).
// 교차점 정의: PMC = "너무 싸다" ∩ "싸지 않다", PME = "너무 비싸다" ∩ "비싸지 않다",
// OPP = "너무 싸다" ∩ "너무 비싸다", IPP = "싸다" ∩ "비싸다". 수용 범위 = [PMC, PME].

export interface VwResponse {
  tooCheap: number;
  cheap: number;
  expensive: number;
  tooExpensive: number;
}

export interface VwResult {
  respondents: number;
  pmc: number | null;
  pme: number | null;
  opp: number | null;
  ipp: number | null;
  /** 15명 미만이면 결정 사항 7번 기준에 못 미친다 */
  enoughRespondents: boolean;
  /** 답의 순서(너무 싸다 ≤ 싸다 ≤ 비싸다 ≤ 너무 비싸다)를 어긴 응답 수 (제외됨) */
  excluded: number;
}

export const VW_MIN_RESPONDENTS = 15;

function intersect(grid: number[], f: (p: number) => number, g: (p: number) => number): number | null {
  let prevP = grid[0]!;
  let prevD = f(prevP) - g(prevP);
  if (prevD === 0) return prevP;
  for (let i = 1; i < grid.length; i++) {
    const p = grid[i]!;
    const d = f(p) - g(p);
    if (d === 0) return p;
    if (Math.sign(d) !== Math.sign(prevD)) {
      return prevP + ((p - prevP) * Math.abs(prevD)) / (Math.abs(prevD) + Math.abs(d));
    }
    prevP = p;
    prevD = d;
  }
  return null;
}

export function vanWestendorp(responses: VwResponse[]): VwResult {
  const valid = responses.filter(
    (r) => r.tooCheap <= r.cheap && r.cheap <= r.expensive && r.expensive <= r.tooExpensive,
  );
  const n = valid.length;
  const empty = { pmc: null, pme: null, opp: null, ipp: null };
  if (n === 0) return { respondents: 0, ...empty, enoughRespondents: false, excluded: responses.length };

  const grid = [...new Set(valid.flatMap((r) => [r.tooCheap, r.cheap, r.expensive, r.tooExpensive]))].sort(
    (a, b) => a - b,
  );
  const share = (pred: (r: VwResponse) => boolean) => valid.filter(pred).length / n;
  const tooCheap = (p: number) => share((r) => r.tooCheap >= p);
  const cheap = (p: number) => share((r) => r.cheap >= p);
  const expensive = (p: number) => share((r) => r.expensive <= p);
  const tooExpensive = (p: number) => share((r) => r.tooExpensive <= p);

  return {
    respondents: n,
    pmc: intersect(grid, tooCheap, (p) => 1 - cheap(p)),
    pme: intersect(grid, tooExpensive, (p) => 1 - expensive(p)),
    opp: intersect(grid, tooCheap, tooExpensive),
    ipp: intersect(grid, cheap, expensive),
    enoughRespondents: n >= VW_MIN_RESPONDENTS,
    excluded: responses.length - n,
  };
}
