// 일치도: Krippendorff α (명목·순서·간격), Cohen κ, α 판정에 필요한 평정 대상 수.
// 기획 "LLM 판단의 신뢰도 척도": α 0.800 이상 자동 적용, 0.667~0.800 사람 검토, 0.667 미만 자동 적용 안 함.

export type Level = "nominal" | "ordinal" | "interval";
type Value = string | number;

/**
 * @param data 평정자 × 대상 행렬. 빈칸은 null.
 * @param levels 순서 척도의 값 순서 (없으면 관측값을 정렬해 쓴다)
 * @returns 짝을 이룰 수 있는 값이 없거나 기대 불일치가 0이면 null
 */
export function krippendorffAlpha(data: Array<Array<Value | null>>, level: Level = "nominal", levels?: Value[]): number | null {
  const units = data[0]?.length ?? 0;
  const values = levels ?? [...new Set(data.flat().filter((v): v is Value => v !== null))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const index = new Map(values.map((v, i) => [v, i]));
  const V = values.length;
  if (V === 0) return null;
  // 일치 행렬 o[c][k]
  const o = Array.from({ length: V }, () => new Array<number>(V).fill(0));
  for (let u = 0; u < units; u++) {
    const vals = data.map((row) => row[u]).filter((v): v is Value => v !== null && v !== undefined);
    const m = vals.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        const c = index.get(vals[i]!);
        const k = index.get(vals[j]!);
        if (c === undefined || k === undefined) throw new Error(`정의되지 않은 값: ${vals[i]} / ${vals[j]}`);
        o[c]![k]! += 1 / (m - 1);
      }
    }
  }
  const nc = o.map((row) => row.reduce((a, b) => a + b, 0));
  const n = nc.reduce((a, b) => a + b, 0);
  if (n <= 1) return null;

  const delta = (c: number, k: number): number => {
    if (c === k) return 0;
    if (level === "nominal") return 1;
    if (level === "interval") {
      const a = Number(values[c]);
      const b = Number(values[k]);
      return (a - b) ** 2;
    }
    const [lo, hi] = c < k ? [c, k] : [k, c];
    let s = 0;
    for (let g = lo; g <= hi; g++) s += nc[g]!;
    s -= (nc[lo]! + nc[hi]!) / 2;
    return s ** 2;
  };

  let Do = 0;
  let De = 0;
  for (let c = 0; c < V; c++) {
    for (let k = 0; k < V; k++) {
      const d = delta(c, k);
      Do += o[c]![k]! * d;
      De += nc[c]! * nc[k]! * d;
    }
  }
  Do /= n;
  De /= n * (n - 1);
  if (De === 0) return null;
  return 1 - Do / De;
}

/** 두 평정자의 Cohen κ (같은 대상에 둘 다 값이 있는 것만) */
export function cohenKappa(a: Array<Value | null>, b: Array<Value | null>): { kappa: number | null; n: number; agreement: number | null } {
  const pairs: Array<[Value, Value]> = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== null && a[i] !== undefined && b[i] !== null && b[i] !== undefined) pairs.push([a[i]!, b[i]!]);
  }
  const n = pairs.length;
  if (!n) return { kappa: null, n: 0, agreement: null };
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([x, y]) => x === y).length / n;
  let pe = 0;
  for (const c of cats) {
    pe += (pairs.filter(([x]) => x === c).length / n) * (pairs.filter(([, y]) => y === c).length / n);
  }
  return { kappa: pe === 1 ? null : (po - pe) / (1 - pe), n, agreement: po };
}

/**
 * α 0.800을 유의수준 0.05로 확인하는 데 필요한 평정 대상 수 (Krippendorff가 쓰는 Bloch·Kraemer 공식, 범주가 고르게 나뉠 때).
 * 기획 문서 값: 2범주 104, 3범주 117, 4범주 139. 범주가 한쪽으로 쏠리면 더 필요하다.
 */
export function requiredUnits(categories: number): number {
  if (categories <= 2) return 104;
  if (categories === 3) return 117;
  return 139;
}

export type GateStatus = "auto" | "review" | "off";

/** 코드 유형 자동 적용 여부 */
export function gate(alpha: number | null, units: number, required: number): GateStatus {
  if (alpha === null || units < required) return "off";
  if (alpha >= 0.8) return "auto";
  if (alpha >= 0.667) return "review";
  return "off";
}
