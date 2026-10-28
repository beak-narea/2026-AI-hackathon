import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { upsertTeam } from "@/lib/services/admin/cohorts";

// 팀 추가·수정 (id가 있으면 수정)
export const POST = route<{ cohortId: string }>(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(
    ctx.req,
    z.object({
      id: z.string().uuid().optional(),
      team_name: z.string().min(1).max(80),
      project_id: z.string().uuid().nullable().optional(),
      is_design_partner: z.boolean().optional(),
      offered_at: z.string().date().nullable().optional(),
      prepaid: z.boolean().nullable().optional(),
      note: z.string().max(1000).optional(),
    }),
  );
  return upsertTeam(ctx.admin, { ...input, cohort_id: ctx.params.cohortId });
});
