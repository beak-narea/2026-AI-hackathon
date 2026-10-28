import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { rateLimit } from "@/lib/api/guards";
import { syncProject } from "@/lib/services/sync";

export const maxDuration = 120;

// integration.sync_now: 지금 가져와 재판정
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  await rateLimit(ctx.admin, `sync:${ctx.params.projectId}`, 12, 3600);
  const input = await body(ctx.req, z.object({ connection_id: z.string().uuid().optional() }));
  return syncProject(ctx.admin, ctx.params.projectId, input.connection_id);
});
