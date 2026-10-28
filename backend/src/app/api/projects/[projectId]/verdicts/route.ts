import { route, must, requireReader } from "@/lib/api/handler";

// 결과 판정 목록 (최신순, 가설 문장과 방법 포함)
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const verdicts = must(
    await ctx.admin
      .from("verdicts")
      .select("*, hypotheses(statement, type, status, criticality, source_field), proposals!verdicts_proposal_id_fkey(method, method_key)")
      .eq("project_id", ctx.params.projectId)
      .order("created_at", { ascending: false }),
  );
  return { verdicts };
}, { auth: false });
