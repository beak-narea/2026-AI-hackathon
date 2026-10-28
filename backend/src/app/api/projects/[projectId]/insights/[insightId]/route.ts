import { z } from "zod";
import { route, body, must, requireEditor, mustAffect } from "@/lib/api/handler";

// insight.confirm: 해석형·검토 대상 인사이트를 사람이 확정하거나 고친다
export const PATCH = route<{ projectId: string; insightId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({ confirmed: z.boolean(), text: z.string().min(2).max(2000).optional(), code_type: z.string().min(1).max(60).optional() }),
  );
  return must(
    await ctx.admin
      .from("insights")
      .update({
        confirmed_by_user: input.confirmed,
        needs_review: !input.confirmed,
        ...(input.text ? { text: input.text } : {}),
        ...(input.code_type ? { code_type: input.code_type } : {}),
      })
      .eq("id", ctx.params.insightId)
      .eq("project_id", ctx.params.projectId)
      .select("*")
      .single(),
  );
});

export const DELETE = route<{ projectId: string; insightId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  mustAffect(await ctx.admin.from("insights").delete().eq("id", ctx.params.insightId).eq("project_id", ctx.params.projectId).select("id"), "인사이트");
  return { removed: ctx.params.insightId };
});
