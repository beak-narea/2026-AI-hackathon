import { z } from "zod";
import { route, body, must, requireEditor, requireMember } from "@/lib/api/handler";
import { inviteMember } from "@/lib/services/members";

type P = { projectId: string };

export const GET = route<P>(async (ctx) => {
  await requireMember(ctx, ctx.params.projectId);
  return { members: must(await ctx.admin.from("project_members").select("*").eq("project_id", ctx.params.projectId).order("invited_at")) };
});

// member.invite (팀원 또는 외부 평가자)
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({ email: z.string().email(), name: z.string().max(60).default(""), role: z.enum(["member", "external_rater"]) }),
  );
  return inviteMember(ctx.admin, ctx.params.projectId, input);
});
