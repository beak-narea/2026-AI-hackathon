import { z } from "zod";
import { route, body, ApiError, must } from "@/lib/api/handler";
import { hashToken, recordObservation } from "@/lib/services/postLaunch";
import { rateLimit } from "@/lib/api/guards";

// 고객사 분석 도구·LLM 모니터링 도구가 값을 보내는 수신 주소.
// Authorization: Bearer <data_connection.add 에서 받은 토큰>
const Payload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("metric"),
    event_name: z.string(),
    successes: z.number().nonnegative(),
    n: z.number().positive(),
    period_start: z.string().datetime(),
    period_end: z.string().datetime(),
  }),
  z.object({
    type: z.literal("llm_cost"),
    total_cost_krw: z.number().nonnegative(),
    tasks: z.number().int().positive(),
    period_start: z.string().datetime(),
    period_end: z.string().datetime(),
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
    const card = must(
      await ctx.admin.from("metric_cards").select("id").eq("project_id", conn.project_id).eq("event_name", input.event_name).maybeSingle(),
      "지표 카드",
    );
    const result = await recordObservation(ctx.admin, conn.project_id, card.id, { ...input, source: conn.tool_name });
    await ctx.admin.from("data_connections").update({ last_sync_at: new Date().toISOString(), status: "connected", last_error: null }).eq("id", conn.id);
    return result;
  }
  const { type: _type, ...cost } = input;
  const row = must(
    await ctx.admin
      .from("cost_observations")
      .insert({ project_id: conn.project_id, ...cost, source: conn.tool_name })
      .select("*")
      .single(),
  );
  await ctx.admin.from("data_connections").update({ last_sync_at: new Date().toISOString(), status: "connected" }).eq("id", conn.id);
  return { cost_observation: row };
}, { auth: false });
