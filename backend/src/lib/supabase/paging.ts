// PostgREST는 한 번에 최대 1000행(기본값)만 돌려준다. 전체가 필요한 조회는 나눠서 모두 읽는다.
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

export const PAGE = 1000;

/** build(from, to)는 같은 정렬 기준으로 .range(from, to)를 붙인 쿼리를 돌려준다 */
export async function selectAll<T>(build: (from: number, to: number) => Page<T>, max = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) {
      const err = new Error(error.message) as Error & { code?: string };
      err.code = error.code;
      throw err;
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** 긴 id 목록을 나눠 .in() 조회 (주소 길이 제한을 넘지 않게) */
export async function selectIn<T>(ids: string[], build: (chunk: string[], from: number, to: number) => Page<T>, chunkSize = 100): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    out.push(...(await selectAll<T>((from, to) => build(chunk, from, to))));
  }
  return out;
}
