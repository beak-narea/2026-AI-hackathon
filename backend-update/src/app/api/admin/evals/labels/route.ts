import { z } from "zod";
import { route, body, query } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { saveLabel, unlabeled } from "@/lib/services/admin/evals";

// 채점기 검증용 사람 라벨
export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  const q = query(ctx.req, z.object({ kind: z.enum(["weakness", "pushback"]) }));
  return unlabeled(ctx.admin, q.kind);
});

export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ id: z.string().uuid(), value: z.boolean() }));
  return saveLabel(ctx.admin, input.id, input.value, ctx.user.id);
});
