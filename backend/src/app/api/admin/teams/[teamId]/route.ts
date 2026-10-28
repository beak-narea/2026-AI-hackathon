import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { deleteTeam } from "@/lib/services/admin/cohorts";

export const DELETE = route<{ teamId: string }>(async (ctx) => {
  requireAdmin(ctx);
  return deleteTeam(ctx.admin, ctx.params.teamId);
});
