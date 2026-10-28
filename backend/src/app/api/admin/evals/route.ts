import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { evalOverview } from "@/lib/services/admin/evals";

export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return evalOverview(ctx.admin);
});
