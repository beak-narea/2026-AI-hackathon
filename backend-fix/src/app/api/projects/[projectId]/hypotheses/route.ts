import { z } from "zod";
import { route, body, projectRole, requireEditor, requireReader } from "@/lib/api/handler";
import { createHypothesis, draftHypotheses, listHypotheses } from "@/lib/services/hypotheses";
import { HYPOTHESIS_TYPES } from "@/lib/domain/rules";

type P = { projectId: string };
export const maxDuration = 300;

// hypotheses: 순위(중요도 → 증거가 약한 것), 평정, 합의, 바깥 관점
export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const { role, isExample } = await projectRole(ctx, ctx.params.projectId);
  return {
    hypotheses: await listHypotheses(ctx.admin, ctx.params.projectId, { userId: ctx.user?.id ?? null, canRate: !!role && !isExample }),
  };
}, { auth: false });

// hypothesis.create: { draft: true } 면 사전 부검으로 초안 생성, 아니면 직접 입력
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.union([
      z.object({ draft: z.literal(true) }),
      z.object({ statement: z.string().min(5).max(1000), type: z.enum(HYPOTHESIS_TYPES), premortem_reason: z.string().max(2000).optional() }),
    ]),
  );
  if ("draft" in input) return draftHypotheses(ctx.admin, ctx.params.projectId, ctx.user.id);
  return createHypothesis(ctx.admin, ctx.params.projectId, input);
});
