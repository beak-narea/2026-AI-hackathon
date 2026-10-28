import { route, requireReader } from "@/lib/api/handler";
import { methodOptions } from "@/lib/services/proposals";

// 이 가설에 쓸 수 있는 실험 방법 (B2B 여부에 따라 다르다)
export const GET = route<{ projectId: string; hypothesisId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return { methods: await methodOptions(ctx.admin, ctx.params.projectId, ctx.params.hypothesisId) };
}, { auth: false });
