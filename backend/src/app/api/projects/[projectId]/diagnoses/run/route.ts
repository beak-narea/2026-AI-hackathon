import { route, requireEditor } from "@/lib/api/handler";
import { runDiagnosis } from "@/lib/services/diagnosis";

export const maxDuration = 300;

// diagnosis.run
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return runDiagnosis(ctx.admin, ctx.params.projectId, ctx.user.id);
});
