import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { listMentors, upsertMentor } from "@/lib/services/mentors";

export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return listMentors(ctx.admin);
});

export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(
    ctx.req,
    z.object({
      id: z.string().uuid().optional(),
      name: z.string().min(1).max(60),
      email: z.string().email(),
      organization: z.string().max(120).optional(),
      expertise: z.array(z.string().max(40)).max(20).optional(),
      fee_krw: z.number().int().nonnegative().optional(),
      active: z.boolean().optional(),
    }),
  );
  return upsertMentor(ctx.admin, input);
});
