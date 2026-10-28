import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { setExpertBaseline } from "@/lib/services/admin/evals";

// 같은 세트에 대한 전문가 2인 평균 탐지율
export const PUT = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ detection_rate: z.number().min(0).max(1), experts: z.number().int().min(2), note: z.string().max(1000).optional() }));
  return setExpertBaseline(ctx.admin, input);
});
