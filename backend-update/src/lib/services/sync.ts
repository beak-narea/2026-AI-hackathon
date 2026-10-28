// 고객 도구 연동: 자격 증명 암호화 저장, 정기 가져오기, 같은 3갈래 규칙으로 재판정 (기획 6번 기능)
import "server-only";
import { z } from "zod";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must } from "../api/handler";
import { isDemo, serverEnv } from "../env";
import { open, seal } from "../crypto/secretBox";
import {
  CONFIG_SCHEMAS, PROVIDER_KIND, PROVIDER_LABEL, countUniques, demoFetcher, llmCost, publicConfig,
  type Fetcher, type Provider, type ProviderConfig,
} from "../integrations/providers";
import { recordObservation } from "./postLaunch";
import { notifyProject } from "./notifications";

const DAY = 86_400_000;

function encryptionKey(): string {
  const key = serverEnv().ENCRYPTION_KEY;
  if (key) return key;
  if (isDemo()) return "demo-mode-only-encryption-key-do-not-use-in-production";
  throw new Error("환경 변수 설정 오류: ENCRYPTION_KEY (연동 자격 증명 암호화에 필요)");
}

const fetcher = (): Fetcher => (isDemo() ? demoFetcher : fetch);

export async function addIntegration(admin: Db, projectId: string, provider: Provider, rawConfig: unknown) {
  const parsed = CONFIG_SCHEMAS[provider].safeParse(rawConfig);
  if (!parsed.success) throw parsed.error;
  const cfg = parsed.data as Record<string, unknown>;
  const sealed = seal(cfg, encryptionKey());
  const conn = must(
    await admin
      .from("data_connections")
      .insert({
        project_id: projectId,
        tool_name: PROVIDER_LABEL[provider],
        kind: PROVIDER_KIND[provider],
        provider,
        config: publicConfig(provider, cfg),
        status: "connected",
      })
      .select("*")
      .single(),
  );
  must(await admin.from("connection_secrets").insert({ connection_id: conn.id, encrypted_config: sealed }).select("connection_id"));
  const test = await testConnection(admin, projectId, conn.id as string);
  return { connection: { ...conn, status: test.ok ? "connected" : "error", last_error: test.ok ? null : test.error }, test };
}

async function loadConfig<P extends Provider>(admin: Db, connectionId: string): Promise<ProviderConfig[P]> {
  const secret = must(await admin.from("connection_secrets").select("encrypted_config").eq("connection_id", connectionId).maybeSingle(), "자격 증명");
  if (!secret.encrypted_config) throw badRequest("이 연결은 수신 토큰 방식이다");
  return open<ProviderConfig[P]>(secret.encrypted_config as string, encryptionKey());
}

type Conn = { id: string; project_id: string; provider: Provider | "webhook"; tool_name: string; kind: string; last_sync_at: string | null; status: string };

/** 연결 확인: 최근 하루 값을 한 번 읽어 본다 */
export async function testConnection(admin: Db, projectId: string, connectionId: string): Promise<{ ok: boolean; error?: string }> {
  const conn = must(await admin.from("data_connections").select("*").eq("id", connectionId).eq("project_id", projectId).maybeSingle(), "연결") as Conn;
  if (conn.provider === "webhook") return { ok: true };
  const to = new Date();
  const from = new Date(to.getTime() - DAY);
  try {
    if (conn.provider === "langfuse") await llmCost(await loadConfig<"langfuse">(admin, conn.id), from, to, fetcher());
    else await countUniques(conn.provider, await loadConfig<"posthog">(admin, conn.id), "$pageview", from, to, fetcher());
    await admin.from("data_connections").update({ status: "connected", last_error: null }).eq("id", conn.id);
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    await admin.from("data_connections").update({ status: "error", last_error: error }).eq("id", conn.id);
    return { ok: false, error };
  }
}

export const MetricSource = z.object({
  numerator_event: z.string().min(1).max(200),
  denominator_event: z.string().min(1).max(200),
  window_days: z.number().int().min(1).max(90).default(30),
});
export type MetricSource = z.infer<typeof MetricSource>;

/** 지표 카드를 어떤 이벤트로 잴지 (기준값이 아니므로 잠근 뒤에도 바꿀 수 있다) */
export async function setMetricSource(admin: Db, projectId: string, cardId: string, source: MetricSource | null) {
  return must(await admin.from("metric_cards").update({ source }).eq("id", cardId).eq("project_id", projectId).select("*").single());
}

interface SyncResult {
  connection_id: string;
  provider: string;
  metrics: Array<{ card_id: string; event_name: string; successes?: number; n?: number; result?: string; skipped?: string }>;
  cost?: { period_start: string; period_end: string; total_cost_krw: number; tasks: number } | { skipped: string };
  error?: string;
}

export async function syncConnection(admin: Db, conn: Conn, now = new Date()): Promise<SyncResult> {
  const out: SyncResult = { connection_id: conn.id, provider: conn.provider, metrics: [] };
  try {
    if (conn.provider === "posthog" || conn.provider === "amplitude") {
      const cfg = await loadConfig<"posthog">(admin, conn.id);
      const { data: cards } = await admin.from("metric_cards").select("*").eq("project_id", conn.project_id).not("locked_at", "is", null);
      for (const card of (cards ?? []) as Array<{ id: string; event_name: string; source: MetricSource | null; observed_at: string | null }>) {
        if (!card.source) {
          out.metrics.push({ card_id: card.id, event_name: card.event_name, skipped: "측정 이벤트 미설정" });
          continue;
        }
        if (card.observed_at && now.getTime() - new Date(card.observed_at).getTime() < 20 * 3600_000) {
          out.metrics.push({ card_id: card.id, event_name: card.event_name, skipped: "오늘 이미 측정함" });
          continue;
        }
        const from = new Date(now.getTime() - card.source.window_days * DAY);
        const [successes, n] = await Promise.all([
          countUniques(conn.provider, cfg, card.source.numerator_event, from, now, fetcher()),
          countUniques(conn.provider, cfg, card.source.denominator_event, from, now, fetcher()),
        ]);
        if (n <= 0) {
          out.metrics.push({ card_id: card.id, event_name: card.event_name, skipped: "분모 이벤트가 0건" });
          continue;
        }
        const k = Math.min(successes, n);
        const r = await recordObservation(admin, conn.project_id, card.id, {
          successes: k,
          n,
          period_start: from.toISOString(),
          period_end: now.toISOString(),
          source: conn.tool_name,
        });
        out.metrics.push({ card_id: card.id, event_name: card.event_name, successes: k, n, result: r.verdict.result });
        if (r.verdict.result === "not_met") {
          await notifyProject(admin, conn.project_id, {
            kind: "metric_not_met",
            title: `출시 후 지표 미달: ${card.event_name}`,
            body: `${k}/${n} (${conn.tool_name}, 최근 ${card.source.window_days}일). 가설을 '재검증 필요'로 되돌렸습니다.`,
            link: `/projects/${conn.project_id}/post-launch`,
            dedupeKey: `metric:${card.id}:${now.toISOString().slice(0, 10)}`,
          });
        }
      }
    } else if (conn.provider === "langfuse") {
      const cfg = await loadConfig<"langfuse">(admin, conn.id);
      // 겹치지 않게: 지난번 기록 끝부터 오늘 0시(UTC)까지
      const { data: last } = await admin
        .from("cost_observations")
        .select("period_end")
        .eq("project_id", conn.project_id)
        .eq("source", conn.tool_name)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const from = last?.period_end ? new Date(last.period_end as string) : new Date(to.getTime() - 30 * DAY);
      if (to.getTime() - from.getTime() < DAY) {
        out.cost = { skipped: "새로 가져올 기간이 없다 (하루 단위)" };
      } else {
        const { costUsd, tasks } = await llmCost(cfg, from, to, fetcher());
        if (tasks <= 0) out.cost = { skipped: "기간 안의 작업(트레이스)이 0건" };
        else {
          const total = Math.round(costUsd * serverEnv().USD_KRW);
          await admin.from("cost_observations").insert({
            project_id: conn.project_id,
            period_start: from.toISOString(),
            period_end: to.toISOString(),
            total_cost_krw: total,
            tasks,
            source: conn.tool_name,
          });
          out.cost = { period_start: from.toISOString(), period_end: to.toISOString(), total_cost_krw: total, tasks };
        }
      }
    }
    await admin.from("data_connections").update({ status: "connected", last_error: null, last_sync_at: now.toISOString() }).eq("id", conn.id);
  } catch (e) {
    out.error = (e as Error).message.slice(0, 500);
    await admin.from("data_connections").update({ status: "error", last_error: out.error }).eq("id", conn.id);
  }
  return out;
}

export async function syncProject(admin: Db, projectId: string, connectionId?: string) {
  let q = admin.from("data_connections").select("*").eq("project_id", projectId).neq("provider", "webhook");
  if (connectionId) q = q.eq("id", connectionId);
  const conns = must(await q) as Conn[];
  if (!conns.length) throw conflict("가져오기 연동(PostHog·Amplitude·Langfuse)이 없다");
  const results = [];
  for (const c of conns) results.push(await syncConnection(admin, c));
  return { results };
}

/** 예약 작업: 모든 가져오기 연동 */
export async function syncAll(admin: Db) {
  const { data } = await admin.from("data_connections").select("*").neq("provider", "webhook").neq("status", "disconnected");
  const results = [];
  for (const c of (data ?? []) as Conn[]) results.push(await syncConnection(admin, c));
  return { synced: results.length, errors: results.filter((r) => r.error).length };
}
