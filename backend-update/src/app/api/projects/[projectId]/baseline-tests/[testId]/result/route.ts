import { route, requireReader } from "@/lib/api/handler";
import { baselineResult } from "@/lib/services/baseline";

// 기준선 테스트 판정 (샘플당 다수결, 목표값 70%, 최소 허용치 50%)
export const GET = route<{ projectId: string; testId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return baselineResult(ctx.admin, ctx.params.projectId, ctx.params.testId);
});
