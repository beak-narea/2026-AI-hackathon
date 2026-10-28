import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { settleCriticality } from "@/lib/services/hypotheses";
import { CRITICALITY } from "@/lib/domain/rules";

// 평정이 엇갈린 항목을 토론한 뒤 팀이 확정
export const POST = route<{ projectId: string; hypothesisId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const { level } = await body(ctx.req, z.object({ level: z.enum(CRITICALITY) }));
  return settleCriticality(ctx.admin, ctx.params.projectId, ctx.params.hypothesisId, level);
});
