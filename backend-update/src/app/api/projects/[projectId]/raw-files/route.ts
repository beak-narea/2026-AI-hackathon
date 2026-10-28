import { route, requireMember } from "@/lib/api/handler";
import { listRawFiles } from "@/lib/services/rawFiles";

// 원자료 목록 (가명 처리된 사본, 보관 기간)
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireMember(ctx, ctx.params.projectId);
  return listRawFiles(ctx.admin, ctx.params.projectId);
});
