import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { submitUsageMeasurement } from "@/lib/services/evidence";

// evidence.submit_usage: 실사용 지표를 직접 집계해 낸다 (분석 도구를 연결했다면 측정 기간이 끝날 때 자동으로 들어온다)
export const POST = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      successes: z.number().int().nonnegative(),
      n: z.number().int().positive(),
      source: z.string().trim().min(2).max(200),
      memo: z.string().max(4000).optional(),
    }),
  );
  return submitUsageMeasurement(ctx.admin, ctx.params.projectId, ctx.params.proposalId, ctx.user.id, input);
});
