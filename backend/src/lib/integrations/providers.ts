// 고객 팀의 분석 도구·LLM 모니터링 도구에서 값을 가져오는 어댑터.
// 서비스는 분석을 하지 않는다. 실사용 지표 기획서에 정한 이벤트의 고유 사용자 수와 AI 비용만 읽는다.
import { z } from "zod";
import { assertPublicUrl, safeFetch } from "../net/safeFetch";

/** 연동 주소: https 공개 주소의 origin만 받는다 (경로·쿼리·#로 다른 곳을 부르는 것을 막는다) */
const PublicHost = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v, ctx) => {
      try {
        return assertPublicUrl(v.trim()).origin;
      } catch (e) {
        ctx.addIssue({ code: "custom", message: (e as Error).message });
        return z.NEVER;
      }
    });

export const PROVIDERS = ["posthog", "amplitude", "langfuse"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PosthogConfig = z.object({
  host: PublicHost("https://us.posthog.com"),
  project_id: z.string().regex(/^\d{1,12}$/, "PostHog 프로젝트 ID는 숫자다"),
  api_key: z.string().min(10).describe("Personal API key (query:read 권한)"),
});
export const AmplitudeConfig = z.object({
  region: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["us", "eu"])).default("us"),
  api_key: z.string().min(10),
  secret_key: z.string().min(10),
});
export const LangfuseConfig = z.object({
  host: PublicHost("https://cloud.langfuse.com"),
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

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface FetchResult {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type Fetcher = (url: string, init?: FetchInit) => Promise<FetchResult>;

/** 기본: 내부망으로 나가지 않는 fetch, 호출당 30초 */
export const defaultFetcher: Fetcher = (url, init) => safeFetch(url, { ...init, timeoutMs: 30_000, maxBytes: 2_000_000 });

const basic = (a: string, b: string) => `Basic ${Buffer.from(`${a}:${b}`).toString("base64")}`;
const hogString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

// 오류에 상대 서버의 응답 본문을 담지 않는다 (화면에 보이는 last_error로 내부 응답이 새지 않게)
async function okJson<T>(res: FetchResult, who: string): Promise<T> {
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? " (키 또는 권한을 확인)" : res.status === 404 ? " (주소·프로젝트 ID를 확인)" : res.status === 429 ? " (요청 한도 초과, 잠시 뒤 다시)" : "";
    throw new Error(`${who} 응답 ${res.status}${hint}`);
  }
  try {
    return JSON.parse(await res.text()) as T;
  } catch {
    throw new Error(`${who} 응답이 JSON이 아니다 (주소를 확인)`);
  }
}

/** 기간 안에 이 이벤트를 한 번 이상 남긴 고유 사용자 수 */
export async function countUniques(
  provider: "posthog" | "amplitude",
  cfg: ProviderConfig["posthog"] | ProviderConfig["amplitude"],
  event: string,
  from: Date,
  to: Date,
  f: Fetcher = defaultFetcher,
): Promise<number> {
  if (provider === "posthog") {
    const c = cfg as ProviderConfig["posthog"];
    // 시각은 UTC로 고정한다 (PostHog 프로젝트 시간대만큼 기간이 밀리지 않게)
    const ts = (d: Date) => hogString(d.toISOString().slice(0, 19).replace("T", " "));
    const query = `SELECT count(DISTINCT person_id) FROM events WHERE event = ${hogString(event)} AND timestamp >= toDateTime(${ts(from)}, 'UTC') AND timestamp < toDateTime(${ts(to)}, 'UTC')`;
    const res = await f(`${c.host.replace(/\/$/, "")}/api/projects/${encodeURIComponent(c.project_id)}/query/`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.api_key}`, "content-type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "verify-lab-metric" }),
    });
    const data = await okJson<{ results?: unknown[][] }>(res, "PostHog");
    return Number(data.results?.[0]?.[0] ?? 0);
  }
  const c = cfg as ProviderConfig["amplitude"];
  const base = c.region === "eu" ? "https://analytics.eu.amplitude.com" : "https://amplitude.com";
  // Amplitude는 날짜(일) 단위다: 마지막 날을 포함해 정확히 기간 일수만큼
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const params = new URLSearchParams({
    e: JSON.stringify({ event_type: event }),
    start: ymd(new Date(to.getTime() - (days - 1) * 86_400_000)),
    end: ymd(to),
    m: "uniques",
    i: "1",
  });
  const res = await f(`${base}/api/2/events/segmentation?${params}`, {
    headers: { authorization: basic(c.api_key, c.secret_key) },
  });
  const data = await okJson<{ data?: { seriesCollapsed?: Array<Array<{ value: number }>> } }>(res, "Amplitude");
  return Number(data.data?.seriesCollapsed?.[0]?.[0]?.value ?? 0);
}

/** 기간 안의 AI 비용(USD)과 작업 수(최상위 트레이스 수) */
export async function llmCost(cfg: ProviderConfig["langfuse"], from: Date, to: Date, f: Fetcher = defaultFetcher): Promise<{ costUsd: number; tasks: number }> {
  const host = cfg.host.replace(/\/$/, "");
  const headers = { authorization: basic(cfg.public_key, cfg.secret_key) };
  const v2 = async (view: string, metric: { measure: string; aggregation: string }) => {
    const q = { view, metrics: [metric], dimensions: [], filters: [], fromTimestamp: from.toISOString(), toTimestamp: to.toISOString() };
    const res = await f(`${host}/api/public/v2/metrics?query=${encodeURIComponent(JSON.stringify(q))}`, { headers });
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
  const res = await f(`${host}/api/public/metrics/daily?${params}`, { headers });
  const data = await okJson<{ data?: Array<{ totalCost?: number; countTraces?: number }> }>(res, "Langfuse");
  return {
    costUsd: (data.data ?? []).reduce((s, d) => s + Number(d.totalCost ?? 0), 0),
    tasks: (data.data ?? []).reduce((s, d) => s + Number(d.countTraces ?? 0), 0),
  };
}

/** 데모 모드: 외부 호출 없이 이벤트 이름으로 정해지는 값을 돌려준다 */
export const demoFetcher: Fetcher = async (url, init): Promise<FetchResult> => {
  const seed = [...String(url) + String(init?.body ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/query/")) {
    const body = String(init?.body ?? "");
    const isNumerator = !/visit|view|open|session|노출|방문|exposed|offer|shown|seen/.test(body);
    return json({ results: [[isNumerator ? 20 + (seed % 25) : 80]] });
  }
  if (url.includes("segmentation")) {
    const isNumerator = !/visit|view|open|session|exposed|offer|shown|seen/.test(decodeURIComponent(url));
    return json({ data: { seriesCollapsed: [[{ setId: "", value: isNumerator ? 20 + (seed % 25) : 80 }]] } });
  }
  if (url.includes("/v2/metrics")) {
    const q = decodeURIComponent(url);
    return json({ data: [q.includes("totalCost") ? { sum_totalCost: 3 + (seed % 7) } : { count_count: 400 + (seed % 200) }] });
  }
  return new Response("not found", { status: 404 });
};
