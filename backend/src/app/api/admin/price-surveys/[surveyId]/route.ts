import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { setSurveyOpen } from "@/lib/services/admin/pricing";

export const PATCH = route<{ surveyId: string }>(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ open: z.boolean() }));
  return setSurveyOpen(ctx.admin, ctx.params.surveyId, input.open);
});
