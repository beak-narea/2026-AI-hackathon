import { route, requireEditor } from "@/lib/api/handler";
import { restoreProject } from "@/lib/services/projects";

// project.restore
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return restoreProject(ctx.admin, ctx.params.projectId);
});
