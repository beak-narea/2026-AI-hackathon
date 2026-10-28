import { z } from "zod";
import { route, requireEditor, body } from "@/lib/api/handler";
import { recheckVersion } from "@/lib/services/businessModel";

export const maxDuration = 300;

// business_model.check: 고친 사업 모델의 칸별 가설과 자료 점검(충분함·부족함·없음)을 다시 한다
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({ version: z.number().int().positive() }));
  return recheckVersion(ctx.admin, ctx.params.projectId, ctx.user.id, input.version);
});
