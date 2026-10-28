import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { qualityReport } from "@/lib/services/admin/quality";

// 중요도 척도 α·예측 타당도, 설계 가정 추적
export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return qualityReport(ctx.admin);
});
