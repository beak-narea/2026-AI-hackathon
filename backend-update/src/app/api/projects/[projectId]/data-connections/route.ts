import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { addConnection } from "@/lib/services/postLaunch";

type P = { projectId: string };

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return { connections: must(await ctx.admin.from("data_connections").select("*").eq("project_id", ctx.params.projectId)) };
}, { auth: false });

// data_connection.add: 수신 토큰을 한 번만 보여준다
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({ tool_name: z.string().min(1).max(80), kind: z.enum(["analytics", "llm_monitoring"]), config: z.record(z.string(), z.unknown()).optional() }),
  );
  return addConnection(ctx.admin, ctx.params.projectId, input);
});
