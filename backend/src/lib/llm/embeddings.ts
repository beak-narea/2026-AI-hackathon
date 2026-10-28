// WORKBank 유사 업무 검색용 임베딩 (Voyage AI, 1024차원). 키가 없으면 null을 돌려준다.
export async function embed(texts: string[], apiKey: string | undefined, model: string, inputType: "query" | "document"): Promise<number[][] | null> {
  if (!apiKey || texts.length === 0) return null;
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ input: texts, model, input_type: inputType, output_dimension: 1024 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Voyage API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export const toPgVector = (v: number[]) => `[${v.join(",")}]`;
