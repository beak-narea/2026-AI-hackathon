import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { generateProposal } from "@/lib/services/proposals";

type P = { projectId: string };
export const maxDuration = 300;
const Rate = z.number().gt(0).lt(1);

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const proposals = must(
    await ctx.admin.from("proposals").select("*").eq("project_id", ctx.params.projectId).order("created_at", { ascending: false }),
  );
  return { proposals };
}, { auth: false });

// proposal.generate
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      hypothesis_id: z.string().uuid(),
      method_key: z.string().optional(),
      target_value: Rate.optional(),
      min_value: Rate.optional(),
      expected_rate: Rate.optional(),
    }),
  );
  return generateProposal(ctx.admin, ctx.params.projectId, ctx.user.id, input);
});
