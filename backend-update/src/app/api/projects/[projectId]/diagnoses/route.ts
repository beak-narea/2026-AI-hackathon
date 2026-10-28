import { route, must, requireReader } from "@/lib/api/handler";

// diagnosis: 업무별 4구역, 자동화 선호, 체크리스트, 기준선 테스트
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const diagnoses = must(
    await ctx.admin
      .from("diagnoses")
      .select("*, tasks(name, role), wrapper_items(*), baseline_tests(id, model, created_at)")
      .eq("project_id", ctx.params.projectId)
      .order("created_at", { ascending: false }),
  );
  return { diagnoses, demand_prior_notice: "WORKBank 사전값은 미국 노동자 설문 기반 참고용 추정이다. 판정에 쓰지 않는다. 출처: Shao et al." };
}, { auth: false });
