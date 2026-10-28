import { route, requireEditor } from "@/lib/api/handler";
import { cancelRequest } from "@/lib/services/mentors";

export const DELETE = route<{ projectId: string; requestId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return cancelRequest(ctx.admin, ctx.params.projectId, ctx.params.requestId);
});
