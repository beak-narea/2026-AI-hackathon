import { route, requireEditor } from "@/lib/api/handler";
import { removeConnection } from "@/lib/services/connections";

// data_connection.remove
export const DELETE = route<{ projectId: string; connectionId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return removeConnection(ctx.admin, ctx.params.projectId, ctx.params.connectionId);
});
