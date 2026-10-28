import { route, requireEditor } from "@/lib/api/handler";
import { runDevilsAdvocate } from "@/lib/services/hypotheses";

export const maxDuration = 300;

// LLM 반대 평가자 (사람 평정과 2단계 차이만 "재검토")
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return runDevilsAdvocate(ctx.admin, ctx.params.projectId, ctx.user.id);
});
