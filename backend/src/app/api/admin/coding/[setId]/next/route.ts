import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { nextSegments } from "@/lib/services/coding";

export const GET = route<{ setId: string }>(async (ctx) => {
  requireAdmin(ctx);
  return nextSegments(ctx.admin, ctx.params.setId, ctx.user.id);
});
