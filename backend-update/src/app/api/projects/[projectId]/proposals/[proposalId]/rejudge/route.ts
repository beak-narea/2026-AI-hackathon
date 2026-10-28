import { route, requireEditor } from "@/lib/api/handler";
import { rejudgeProposal } from "@/lib/services/proposals";

// verdict.rejudge: 판정 보류 → 표본을 늘린 재판정 제안 (최대 4회)
export const POST = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return rejudgeProposal(ctx.admin, ctx.params.projectId, ctx.params.proposalId);
});
