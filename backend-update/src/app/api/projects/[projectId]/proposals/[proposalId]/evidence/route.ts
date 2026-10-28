import { route, body, requireEditor } from "@/lib/api/handler";
import { EvidenceForm, submitEvidence } from "@/lib/services/evidence";

// evidence.submit: 결과 제출 폼 → 증거 수준·유효 표본 계산 → 판정
export const POST = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const form = await body(ctx.req, EvidenceForm);
  return submitEvidence(ctx.admin, ctx.params.projectId, ctx.params.proposalId, ctx.user.id, form);
});
