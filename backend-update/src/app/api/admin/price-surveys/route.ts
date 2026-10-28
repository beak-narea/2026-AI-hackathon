import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { createSurvey, surveyResults } from "@/lib/services/admin/pricing";

export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return surveyResults(ctx.admin);
});

export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ title: z.string().min(1).max(120), description: z.string().max(2000).optional() }));
  return createSurvey(ctx.admin, input);
});
