import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { listNotifications, markRead } from "@/lib/services/notifications";

export const GET = route(async (ctx) => listNotifications(ctx.admin, ctx.user.id));

// 읽음 표시: { ids: [...] } 또는 { all: true }
export const POST = route(async (ctx) => {
  const input = await body(ctx.req, z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional() }));
  return markRead(ctx.admin, ctx.user.id, input.all ? "all" : (input.ids ?? []));
});
