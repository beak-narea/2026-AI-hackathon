// 고객 팀의 분석 도구·LLM 모니터링 도구에서 값을 가져오는 어댑터.
// 서비스는 분석을 하지 않는다. 지표 카드에 정한 이벤트의 고유 사용자 수와 AI 비용만 읽는다.
import { z } from "zod";

export const PROVIDERS = ["posthog", "amplitude", "langfuse"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PosthogConfig = z.object({
  host: z.string().url().default("https://us.posthog.com"),
  project_id: z.string().min(1).max(40),
  api_key: z.string().min(10).describe("Personal API key (query:read 권한)"),
});
export const AmplitudeConfig = z.object({
  region: z.enum(["us", "eu"]).default("us"),
  api_key: z.string().min(10),
  secret_key: z.string().min(10),
});
export const LangfuseConfig = z.object({
  host: z.string().url().default("https://cloud.langfuse.com"),
  public_key: z.string().min(5),
  secret_key: z.string().min(5),
});
export const CONFIG_SCHEMAS = { posthog: PosthogConfig, amplitude: AmplitudeConfig, langfuse: LangfuseConfig } as const;
export type ProviderConfig = {
  posthog: z.infer<typeof PosthogConfig>;
  amplitude: z.infer<typeof AmplitudeConfig>;
  langfuse: z.infer<typeof LangfuseConfig>;
};

export const PROVIDER_LABEL: Record<Provider, string> = { posthog: "PostHog", amplitude: "Amplitude", langfuse: "Langfuse" };
export const PROVIDER_KIND: Record<Provider, "analytics" | "llm_monitoring"> = {
  posthog: "analytics",
  amplitude: "analytics",
  langfuse: "llm_monitoring",
};

/** 화면에 보여도 되는 설정 (비밀값 제외) */
export function publicConfig(provider: Provider, cfg: Record<string, unknown>): Record<string, unknown> {
  if (provider === "posthog") return { host: cfg.host, project_id: cfg.project_id };
  if (provider === "amplitude") return { region: cfg.region };
  return { host: cfg.host };
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const basic = (a: string, b: string) => `Basic ${Buffer.from(`${a}:${b}`).toString("base64")}`;
const hogString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

async function okJson<T>(res: Response, who: string): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${who} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** 기간 안에 이 이벤트를 한 번 이상 남긴 고유 사용자 수 */
export async function countUniques(
  provider: "posthog" | "amplitude",
  cfg: ProviderConfig["posthog"] | ProviderConfig["amplitude"],
  event: string,
  from: Date,
  to: Date,
  f: Fetcher = fetch,
): Promise<number> {
  if (provider === "posthog") {
    const c = cfg as ProviderConfig["posthog"];
    const query = `SELECT count(DISTINCT person_id) FROM events WHERE event = ${hogString(event)} AND timestamp >= toDateTime(${hogString(
      from.toISOString().slice(0, 19).replace("T", " "),
    )}) AND timestamp < toDateTime(${hogString(to.toISOString().slice(0, 19).replace("T", " "))})`;
    const res = await f(`${c.host.replace(/\/$/, "")}/api/projects/${encodeURIComponent(c.project_id)}/query/`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.api_key}`, "content-type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "verify-lab-metric" }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await okJson<{ results?: unknown[][] }>(res, "PostHog");
    return Number(data.results?.[0]?.[0] ?? 0);
  }
  const c = cfg as ProviderConfig["amplitude"];
  const base = c.region === "eu" ? "https://analytics.eu.amplitude.com" : "https://amplitude.com";
  const params = new URLSearchParams({
    e: JSON.stringify({ event_type: event }),
    start: ymd(from),
    end: ymd(new Date(to.getTime() - 1)),
    m: "uniques",
    i: "30",
  });
  const res = await f(`${base}/api/2/events/segmentation?${params}`, {
    headers: { authorization: basic(c.api_key, c.secret_key) },
    signal: AbortSignal.timeout(60_000),
  });
  const data = await okJson<{ data?: { seriesCollapsed?: Array<Array<{ value: number }>> } }>(res, "Amplitude");
  return Number(data.data?.seriesCollapsed?.[0]?.[0]?.value ?? 0);
}

/** 기간 안의 AI 비용(USD)과 작업 수(최상위 트레이스 수) */
export async function llmCost(cfg: ProviderConfig["langfuse"], from: Date, to: Date, f: Fetcher = fetch): Promise<{ costUsd: number; tasks: number }> {
  const host = cfg.host.replace(/\/$/, "");
  const headers = { authorization: basic(cfg.public_key, cfg.secret_key) };
  const v2 = async (view: string, metric: { measure: string; aggregation: string }) => {
    const q = { view, metrics: [metric], dimensions: [], filters: [], fromTimestamp: from.toISOString(), toTimestamp: to.toISOString() };
    const res = await f(`${host}/api/public/v2/metrics?query=${encodeURIComponent(JSON.stringify(q))}`, { headers, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return null;
    const data = await okJson<{ data?: Array<Record<string, unknown>> }>(res, "Langfuse");
    const key = `${metric.aggregation}_${metric.measure}`;
    return (data.data ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);
  };
  const cost = await v2("observations", { measure: "totalCost", aggregation: "sum" });
  const traces = await v2("traces", { measure: "count", aggregation: "count" });
  if (cost !== null && traces !== null) return { costUsd: cost, tasks: traces };
  // 자체 호스팅 구버전: v1 일별 지표
  const params = new URLSearchParams({ fromTimestamp: from.toISOString(), toTimestamp: to.toISOString(), limit: "100" });
  const res = await f(`${host}/api/public/metrics/daily?${params}`, { headers, signal: AbortSignal.timeout(60_000) });
  const data = await okJson<{ data?: Array<{ totalCost?: number; countTraces?: number }> }>(res, "Langfuse");
  return {
    costUsd: (data.data ?? []).reduce((s, d) => s + Number(d.totalCost ?? 0), 0),
    tasks: (data.data ?? []).reduce((s, d) => s + Number(d.countTraces ?? 0), 0),
  };
}

/** 데모 모드: 외부 호출 없이 이벤트 이름으로 정해지는 값을 돌려준다 */
export const demoFetcher: Fetcher = async (url, init) => {
  const seed = [...String(url) + String(init?.body ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/query/")) {
    const body = String(init?.body ?? "");
    const isNumerator = !/visit|view|open|session|노출|방문|exposed/.test(body);
    return json({ results: [[isNumerator ? 20 + (seed % 25) : 80]] });
  }
  if (url.includes("segmentation")) {
    const isNumerator = !/visit|view|open|session|exposed/.test(decodeURIComponent(url));
    return json({ data: { seriesCollapsed: [[{ setId: "", value: isNumerator ? 20 + (seed % 25) : 80 }]] } });
  }
  if (url.includes("/v2/metrics")) {
    const q = decodeURIComponent(url);
    return json({ data: [q.includes("totalCost") ? { sum_totalCost: 3 + (seed % 7) } : { count_count: 400 + (seed % 200) }] });
  }
  return new Response("not found", { status: 404 });
};
