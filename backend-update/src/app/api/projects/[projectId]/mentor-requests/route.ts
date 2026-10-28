import { z } from "zod";
import { route, body, requireEditor, requireMember } from "@/lib/api/handler";
import { listProjectRequests, requestMentor } from "@/lib/services/mentors";

type P = { projectId: string };

export const GET = route<P>(async (ctx) => {
  await requireMember(ctx, ctx.params.projectId);
  return listProjectRequests(ctx.admin, ctx.params.projectId);
});

// mentor.request: 팀이 외부 평가자를 구하지 못했을 때 제휴 멘토 연결 요청
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({ hypothesis_id: z.string().uuid().nullable().optional(), topic: z.string().max(1000).default("") }));
  return requestMentor(ctx.admin, ctx.params.projectId, ctx.user.id, input);
});
