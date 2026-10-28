import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { startBaseline } from "@/lib/services/baseline";

export const maxDuration = 300;

// baseline_test.start: 실제 입력 샘플 10개 이상 + 자사 결과
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      diagnosis_id: z.string().uuid().nullable().optional(),
      instruction: z.string().min(5).max(4000),
      samples: z.array(z.object({ input: z.string().min(1).max(8000), ours: z.string().min(1).max(8000) })).min(10).max(60),
    }),
  );
  return startBaseline(ctx.admin, ctx.params.projectId, ctx.user.id, input);
});
