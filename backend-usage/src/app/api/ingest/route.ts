import { z } from "zod";
import { route, body, ApiError, must } from "@/lib/api/handler";
import { hashToken } from "@/lib/services/connections";
import { submitUsageMeasurement } from "@/lib/services/evidence";
import { USAGE_METHOD_KEYS } from "@/lib/domain/experiments";
import { rateLimit } from "@/lib/api/guards";

// 고객사 분석 도구·LLM 모니터링 도구가 값을 보내는 수신 주소.
// metric: 실사용 지표 기획서의 결과 (분자 이벤트 이름 또는 기획서 id로 찾는다). 기준을 잠근 기획서에 한 번만 받는다.
// Authorization: Bearer <data_connection.add 에서 받은 토큰>
const Payload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("metric"),
    /** 분자 이벤트 이름 */
    event_name: z.string().optional(),
    /** 같은 분자 이벤트의 기획서가 여럿이면 어느 기획서인지 지정한다 */
    proposal_id: z.string().uuid().optional(),
    successes: z.number().int().nonnegative(),
    n: z.number().int().positive(),
    period_start: z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString()),
    period_end: z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString()),
  }),
  z.object({
    type: z.literal("llm_cost"),
    total_cost_krw: z.number().nonnegative(),
    tasks: z.number().int().positive(),
    period_start: z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString()),
    period_end: z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString()),
  }),
]);

export const POST = route(async (ctx) => {
  const token = ctx.req.headers.get("authorization")?.match(/^Bearer\s+(vs_\S+)$/)?.[1];
  if (!token) throw new ApiError(401, "unauthorized", "수신 토큰이 필요하다");
  const { data: secret } = await ctx.admin.from("connection_secrets").select("connection_id").eq("token_hash", hashToken(token)).maybeSingle();
  if (!secret) throw new ApiError(401, "unauthorized", "알 수 없는 토큰");
  await rateLimit(ctx.admin, `ingest:${secret.connection_id}`, 600, 3600);
  const conn = must(await ctx.admin.from("data_connections").select("*").eq("id", secret.connection_id).maybeSingle(), "연결");
  const input = await body(ctx.req, Payload);

  if (input.type === "metric") {
    if (!input.event_name && !input.proposal_id) throw new ApiError(400, "bad_request", "event_name이나 proposal_id 가운데 하나가 필요하다");
    let q = ctx.admin
      .from("proposals")
      .select("id, metric_source")
      .eq("project_id", conn.project_id)
      .in("method_key", [...USAGE_METHOD_KEYS])
      .not("locked_at", "is", null)
      .neq("status", "received");
    if (input.proposal_id) q = q.eq("id", input.proposal_id);
    if (input.event_name) q = q.eq("metric_source->>numerator_event", input.event_name);
    const found = must(await q.limit(2)) as Array<{ id: string }>;
    const what = input.event_name ? `이벤트 ${input.event_name}` : `기획서 ${input.proposal_id}`;
    if (!found.length) throw new ApiError(404, "not_found", `${what}로 결과를 기다리는 실사용 지표 기획서가 없다 (기준을 잠갔는지 확인)`);
    if (found.length > 1) throw new ApiError(409, "conflict", `${what}의 기획서가 여럿이다. proposal_id로 지정한다`);
    const result = await submitUsageMeasurement(ctx.admin, conn.project_id, found[0]!.id, null, {
      successes: input.successes,
      n: input.n,
      source: `${conn.tool_name} 수신`,
      period_start: input.period_start,
      period_end: input.period_end,
    });
    await ctx.admin.from("data_connections").update({ last_sync_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", conn.id);
    return result;
  }
  const { type: _type, ...cost } = input;
  const inserted = await ctx.admin
      .from("cost_observations")
      .insert({ project_id: conn.project_id, ...cost, source: conn.tool_name })
      .select("*")
      .single();
  if (inserted.error?.code === "23505") throw new ApiError(409, "conflict", "같은 기간의 비용을 이미 받았다");
  const row = must(inserted);
  await ctx.admin.from("data_connections").update({ last_sync_at: new Date().toISOString(), status: "connected" }).eq("id", conn.id);
  return { cost_observation: row };
}, { auth: false });
