import { z } from "zod";
import { route, body, must, requireEditor } from "@/lib/api/handler";
import { HYPOTHESIS_TYPES } from "@/lib/domain/rules";

type P = { projectId: string; hypothesisId: string };

export const PATCH = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({ statement: z.string().min(5).max(1000).optional(), type: z.enum(HYPOTHESIS_TYPES).optional(), premortem_reason: z.string().max(2000).optional(),
      diagnosis_id: z.string().uuid().nullable().optional(),
      diagnosis_axis: z.enum(["feasibility", "demand", "buyer_demand"]).nullable().optional(),
    }),
  );
  if (input.diagnosis_id) {
    must(await ctx.admin.from("diagnoses").select("id").eq("id", input.diagnosis_id).eq("project_id", ctx.params.projectId).maybeSingle(), "진단");
  }
  return must(
    await ctx.admin
      .from("hypotheses")
      .update({ ...input, edited_by_user: true })
      .eq("id", ctx.params.hypothesisId)
      .eq("project_id", ctx.params.projectId)
      .select("*")
      .single(),
  );
});

export const DELETE = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const res = await ctx.admin
    .from("hypotheses")
    .delete()
    .eq("id", ctx.params.hypothesisId)
    .eq("project_id", ctx.params.projectId)
    .eq("status", "unverified")
    .select("id");
  if (!res.data?.length) {
    return Response.json({ error: { code: "conflict", message: "검증을 시작한 가설은 지울 수 없다" } }, { status: 409 });
  }
  return { removed: ctx.params.hypothesisId };
});
