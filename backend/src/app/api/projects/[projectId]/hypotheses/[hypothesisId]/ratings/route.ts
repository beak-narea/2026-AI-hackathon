import { z } from "zod";
import { route, body, requireMember } from "@/lib/api/handler";
import { rateCriticality } from "@/lib/services/hypotheses";
import { CRITICALITY } from "@/lib/domain/rules";

// hypothesis.rate_criticality: 서로 보지 않고 매긴다 (팀원 또는 외부 평가자)
export const POST = route<{ projectId: string; hypothesisId: string }>(async (ctx) => {
  const role = await requireMember(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({ level: z.enum(CRITICALITY), note: z.string().max(2000).default("") }));
  const { data: m } = await ctx.admin
    .from("project_members")
    .select("name, email")
    .eq("project_id", ctx.params.projectId)
    .eq("user_id", ctx.user.id)
    .limit(1)
    .maybeSingle();
  return rateCriticality(
    ctx.admin,
    ctx.params.projectId,
    ctx.params.hypothesisId,
    { userId: ctx.user.id, name: m?.name || m?.email || "평가자", type: role === "external_rater" ? "external" : "team" },
    input.level,
    input.note,
  );
});
