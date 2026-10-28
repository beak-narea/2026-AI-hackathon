import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { recordObservation } from "@/lib/services/postLaunch";

// 출시 후 관측값 수동 입력 → 재검증 판정
export const POST = route<{ projectId: string; cardId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      successes: z.number().nonnegative(),
      n: z.number().positive(),
      period_start: z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString()).optional(),
      period_end: z.string().datetime({ offset: true }).transform((v) => new Date(v).toISOString()).optional(),
    }),
  );
  return recordObservation(ctx.admin, ctx.params.projectId, ctx.params.cardId, { ...input, source: "manual" });
});
