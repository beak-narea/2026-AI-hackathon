import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { recordDecision } from "@/lib/services/decisions";
import { DECISION_CHOICES } from "@/lib/domain/rules";

type P = { projectId: string };

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return { decisions: must(await ctx.admin.from("decisions").select("*").eq("project_id", ctx.params.projectId).order("decided_at", { ascending: false })) };
}, { auth: false });

// decision.record
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      hypothesis_id: z.string().uuid(),
      verdict_id: z.string().uuid().nullable().optional(),
      choice: z.enum(DECISION_CHOICES),
      reason_type: z.enum(["evidence", "external", "other"]),
      note: z.string().max(4000).optional(),
    }),
  );
  return recordDecision(ctx.admin, ctx.params.projectId, ctx.user.id, input);
});
