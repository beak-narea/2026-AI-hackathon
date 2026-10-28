import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { lockProposal } from "@/lib/services/proposals";

const Rate = z.number().gt(0).lt(1);

// proposal.lock_thresholds
export const POST = route<{ projectId: string; proposalId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z
      .object({
        target_value: Rate,
        min_value: Rate,
        expected_rate: Rate,
        cluster_size: z.number().min(1).max(100).nullable().optional(),
        icc: z.number().min(0).max(1).nullable().optional(),
      })
      .refine((v) => v.target_value > v.min_value, { message: "목표값은 최소 허용치보다 커야 한다" }),
  );
  return lockProposal(ctx.admin, ctx.params.projectId, ctx.params.proposalId, input);
});
