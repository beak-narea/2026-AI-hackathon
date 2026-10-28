import { route, requireEditor } from "@/lib/api/handler";
import { testConnection } from "@/lib/services/sync";

// 연결 확인
export const POST = route<{ projectId: string; connectionId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return testConnection(ctx.admin, ctx.params.projectId, ctx.params.connectionId);
});
