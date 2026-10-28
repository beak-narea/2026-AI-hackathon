import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { labelSegments } from "@/lib/services/coding";

export const POST = route<{ setId: string }>(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ labels: z.array(z.object({ segment_id: z.string().uuid(), code_type: z.string().min(1) })).min(1).max(100) }));
  return labelSegments(ctx.admin, ctx.params.setId, ctx.user.id, input.labels);
});
