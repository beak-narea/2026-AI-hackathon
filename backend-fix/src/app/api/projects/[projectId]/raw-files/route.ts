import { route, requireEditor } from "@/lib/api/handler";
import { listRawFiles } from "@/lib/services/rawFiles";

// 원자료 목록 (가명 처리된 사본, 보관 기간). 팀만
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId); // 원자료는 팀(소유자·팀원)만. 외부 평가자는 볼 수 없다
  return listRawFiles(ctx.admin, ctx.params.projectId);
});
