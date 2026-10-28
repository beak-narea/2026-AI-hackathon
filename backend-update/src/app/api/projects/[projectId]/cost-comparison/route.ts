import { route, requireReader } from "@/lib/api/handler";
import { costComparison } from "@/lib/services/postLaunch";

// 출시 후 실제 AI 비용 vs 4번 계산기 가정
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return costComparison(ctx.admin, ctx.params.projectId);
}, { auth: false });
