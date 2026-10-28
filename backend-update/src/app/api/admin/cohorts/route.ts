import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { cohortReport, createCohort } from "@/lib/services/admin/cohorts";

export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return cohortReport(ctx.admin);
});

export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ name: z.string().min(1).max(80), started_at: z.string().date().optional(), note: z.string().max(1000).optional() }));
  return createCohort(ctx.admin, input);
});
