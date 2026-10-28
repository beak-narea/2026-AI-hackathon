import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { submitVotes } from "@/lib/services/baseline";
import { clientIp, rateLimit } from "@/lib/api/guards";

export const POST = route<{ token: string }>(async (ctx) => {
  await rateLimit(ctx.admin, `baseline:${clientIp(ctx.req)}`, 30, 3600);
  const input = await body(
    ctx.req,
    z.object({
      evaluator: z.string().min(1).max(40),
      votes: z.array(z.object({ pair_id: z.string().uuid(), chose_a: z.boolean() })).min(1).max(60),
    }),
  );
  return submitVotes(ctx.admin, ctx.params.token, input.evaluator, input.votes);
}, { auth: false });
