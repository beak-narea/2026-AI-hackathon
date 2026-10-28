import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { addSegments } from "@/lib/services/coding";

export const POST = route<{ setId: string }>(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ text: z.string().min(2).max(500_000) }));
  return addSegments(ctx.admin, ctx.params.setId, input.text);
});
