import { route, requireEditor } from "@/lib/api/handler";
import { removeMember } from "@/lib/services/members";

// member.remove
export const DELETE = route<{ projectId: string; memberId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return removeMember(ctx.admin, ctx.params.projectId, ctx.params.memberId);
});
