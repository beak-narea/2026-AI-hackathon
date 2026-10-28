import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { runEval } from "@/lib/services/admin/evals";

export const maxDuration = 300;

// 아첨 점검 한 종류 실행 (실제 모델은 수백 번 호출하므로 npm run eval:sycophancy 를 권장)
export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ kind: z.enum(["weakness", "framing", "pushback"]) }));
  return runEval(ctx.admin, input.kind);
});
