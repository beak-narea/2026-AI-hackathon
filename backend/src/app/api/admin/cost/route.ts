import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { CostSettings, ourCost, saveCostSettings } from "@/lib/services/admin/pricing";

// 우리 서비스 비용 구조: 가격 하한, 월 고정비, 손익분기
export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return ourCost(ctx.admin);
});

export const PUT = route(async (ctx) => {
  requireAdmin(ctx);
  return saveCostSettings(ctx.admin, await body(ctx.req, CostSettings));
});
