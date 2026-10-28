import { route, body, requireEditor } from "@/lib/api/handler";
import { MetricSource, setMetricSource } from "@/lib/services/proposals";

// proposal.set_metric_source: 실사용 지표의 분자·분모 이벤트와 측정 기간 (기준을 잠그기 전에만)
export const PUT = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, MetricSource);
  return { proposal: await setMetricSource(ctx.admin, ctx.params.projectId, ctx.params.proposalId, input) };
});
