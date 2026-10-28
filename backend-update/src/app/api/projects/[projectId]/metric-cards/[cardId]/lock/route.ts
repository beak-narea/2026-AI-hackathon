import { route, requireEditor } from "@/lib/api/handler";
import { lockMetricCard } from "@/lib/services/postLaunch";

export const POST = route<{ projectId: string; cardId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return lockMetricCard(ctx.admin, ctx.params.projectId, ctx.params.cardId);
});
