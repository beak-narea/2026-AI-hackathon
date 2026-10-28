import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { offerAll } from "@/lib/services/admin/cohorts";

// 같은 날·같은 가격으로 선결제 제안한 날짜를 기수 전체에 기록
export const POST = route<{ cohortId: string }>(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ offered_at: z.string().date() }));
  return offerAll(ctx.admin, ctx.params.cohortId, input.offered_at);
});
