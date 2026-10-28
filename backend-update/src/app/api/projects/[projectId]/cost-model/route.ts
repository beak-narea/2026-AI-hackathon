import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { recalculate } from "@/lib/services/cost";

type P = { projectId: string };
const n = z.number().nonnegative();

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const { data } = await ctx.admin
    .from("cost_models")
    .select("*")
    .eq("project_id", ctx.params.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { cost_model: data };
}, { auth: false });

// cost_model.recalculate
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      model_name: z.string().optional(),
      tasksPerUser: n, callsPerTask: n, inputTokens: n, outputTokens: n,
      inputPricePerMTok: n.optional(), outputPricePerMTok: n.optional(),
      cacheSaving: z.number().min(0).max(1).optional(), retryRate: n.optional(),
      reviewHoursPerTask: n.optional(), hourlyWage: n.optional(), monthlyPrice: n,
    }),
  );
  return recalculate(ctx.admin, ctx.params.projectId, input);
});
