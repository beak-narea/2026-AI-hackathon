import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { MetricSource, setMetricSource } from "@/lib/services/sync";

// metric_card.set_source: 분자·분모 이벤트와 기간 (기준값이 아니라 잠근 뒤에도 바꿀 수 있다)
export const PUT = route<{ projectId: string; cardId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({ source: MetricSource.nullable() }));
  return setMetricSource(ctx.admin, ctx.params.projectId, ctx.params.cardId, input.source);
});
