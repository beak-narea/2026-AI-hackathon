import { route, requireReader } from "@/lib/api/handler";
import { recommendation } from "@/lib/services/decisions";

// decision 화면: 최신 판정과 서비스 권고
export const GET = route<{ projectId: string; hypothesisId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return recommendation(ctx.admin, ctx.params.projectId, ctx.params.hypothesisId);
}, { auth: false });
