import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { computeCodeTypeStatus } from "@/lib/services/coding";

// 코드 유형별 α 계산 → 자동 적용 / 사람 검토 / 적용 안 함
export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  return computeCodeTypeStatus(ctx.admin);
});
