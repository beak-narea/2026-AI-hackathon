import { route, requireEditor } from "@/lib/api/handler";
import { reorder } from "@/lib/services/hypotheses";

// hypothesis.reorder: 중요도 → 증거가 약한 것 순으로 다시 매긴다
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return { order: await reorder(ctx.admin, ctx.params.projectId) };
});
