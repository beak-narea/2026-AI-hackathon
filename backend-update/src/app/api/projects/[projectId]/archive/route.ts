import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { archiveProject } from "@/lib/services/projects";

// project.archive
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const { reason } = await body(ctx.req, z.object({ reason: z.string().min(1).max(2000) }));
  return archiveProject(ctx.admin, ctx.params.projectId, reason);
});
