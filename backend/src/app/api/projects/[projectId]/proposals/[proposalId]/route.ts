import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { proposalWithContext } from "@/lib/services/proposals";

type P = { projectId: string; proposalId: string };

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const data = await proposalWithContext(ctx.admin, ctx.params.projectId, ctx.params.proposalId);
  const { data: evidence } = await ctx.admin.from("evidence").select("*").eq("proposal_id", ctx.params.proposalId);
  const { data: verdicts } = await ctx.admin.from("verdicts").select("*").eq("proposal_id", ctx.params.proposalId).order("created_at", { ascending: false });
  return { ...data, evidence: evidence ?? [], verdicts: verdicts ?? [] };
}, { auth: false });

// 실행 가이드 문구 수정 (숫자와 기준은 lock 라우트에서만)
export const PATCH = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      method: z.string().max(300).optional(),
      guide_steps: z.array(z.string().max(1000)).max(20).optional(),
      prerequisites: z.array(z.string().max(300)).max(20).optional(),
      mvp_scope: z.string().max(4000).optional(),
      recruitment: z.string().max(2000).optional(),
      script: z.string().max(8000).optional(),
      operating_rules: z.array(z.string().max(500)).max(20).optional(),
      expected_weeks: z.number().min(0.5).max(8).optional(),
    }),
  );
  return must(
    await ctx.admin
      .from("proposals")
      .update({ ...input, edited_by_user: true })
      .eq("id", ctx.params.proposalId)
      .eq("project_id", ctx.params.projectId)
      .select("*")
      .single(),
  );
});
