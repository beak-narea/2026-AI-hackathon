import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { runLlmCoding } from "@/lib/services/coding";

export const maxDuration = 300;

export const POST = route<{ setId: string }>(async (ctx) => {
  requireAdmin(ctx);
  return runLlmCoding(ctx.admin, ctx.params.setId, ctx.user.id);
});
