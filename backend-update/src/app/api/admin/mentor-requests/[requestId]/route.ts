import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { closeRequest, matchRequest } from "@/lib/services/mentors";

// { mentor_id } = 배정, { status: done|cancelled } = 닫기
export const POST = route<{ requestId: string }>(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ mentor_id: z.string().uuid().optional(), status: z.enum(["done", "cancelled"]).optional() }));
  if (input.mentor_id) return matchRequest(ctx.admin, ctx.params.requestId, input.mentor_id);
  if (input.status) return closeRequest(ctx.admin, ctx.params.requestId, input.status);
  return { ok: false };
});
