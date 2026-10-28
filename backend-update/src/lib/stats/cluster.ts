// 군집 보정: 같은 회사의 여러 명처럼 묶인 관측은 서로 독립이 아니다.
// 설계 효과 DEFF = 1 + (평균 묶음 크기 − 1) × ICC, 유효 표본 = n / DEFF.
// ICC를 모르고 묶음이 있으면 묶음 단위(회사당 1표)로만 센다.

export interface ClusteredCounts {
  /** 개인 단위 시도 수 */
  n: number;
  /** 개인 단위 성공 수 */
  successes: number;
  /** 묶음(회사·팀) 수. 없거나 n과 같으면 묶이지 않은 것으로 본다 */
  clusters?: number | null;
  /** 묶음 단위로 센 성공 수 (회사의 과반이 행동하면 1 등, 제출 폼에서 받는다) */
  clusterSuccesses?: number | null;
  /** 집단 내 상관. 알 때만 넣는다 */
  icc?: number | null;
}

export type EffectiveMethod = "independent" | "design_effect" | "cluster_unit";

export interface EffectiveSample {
  n: number;
  successes: number;
  method: EffectiveMethod;
  designEffect: number;
  warning?: string;
}

export function designEffect(meanClusterSize: number, icc: number): number {
  if (meanClusterSize < 1) throw new RangeError("묶음 크기는 1 이상이어야 한다");
  if (icc < 0 || icc > 1) throw new RangeError("ICC는 0과 1 사이여야 한다");
  return 1 + (meanClusterSize - 1) * icc;
}

export function effectiveSample(c: ClusteredCounts): EffectiveSample {
  const { n, successes } = c;
  const clusters = c.clusters ?? null;
  if (clusters === null || clusters >= n) {
    return { n, successes, method: "independent", designEffect: 1 };
  }
  if (clusters <= 0) throw new RangeError("묶음 수는 1 이상이어야 한다");

  if (c.icc !== null && c.icc !== undefined) {
    const deff = designEffect(n / clusters, c.icc);
    return { n: n / deff, successes: successes / deff, method: "design_effect", designEffect: deff };
  }

  if (c.clusterSuccesses === null || c.clusterSuccesses === undefined) {
    return {
      n: clusters,
      successes: Math.min(clusters, Math.round((successes / n) * clusters)),
      method: "cluster_unit",
      designEffect: n / clusters,
      warning: "묶음 단위 성공 수가 없어 개인 비율로 근사했다. 결과 제출 폼에 회사별 결과를 넣어 달라고 요청한다.",
    };
  }
  return { n: clusters, successes: c.clusterSuccesses, method: "cluster_unit", designEffect: n / clusters };
}
