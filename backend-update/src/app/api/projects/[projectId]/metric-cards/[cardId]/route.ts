import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { updateMetricCard } from "@/lib/services/postLaunch";

const Rate = z.number().gt(0).lt(1);

// 잠그기 전 지표 카드 수정 (출시 후 정의가 다르면 목표값·최소 허용치를 다시 정한다)
export const PATCH = route<{ projectId: string; cardId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      event_name: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
      definition: z.string().min(5).max(2000).optional(),
      target_value: Rate.optional(),
      min_value: Rate.optional(),
      alert_rule: z.string().max(500).optional(),
    }),
  );
  return updateMetricCard(ctx.admin, ctx.params.projectId, ctx.params.cardId, input);
});
