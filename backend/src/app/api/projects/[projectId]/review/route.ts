import { z } from "zod";
import { route, body, requireEditor, requireReader } from "@/lib/api/handler";
import { recordReview, reviewState } from "@/lib/services/review";

type P = { projectId: string };

// 증거-계획 불일치 경고와 점검 주기
export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return reviewState(ctx.admin, ctx.params.projectId);
}, { auth: false });

// review.record: 점검 기록 (다음 점검일을 다시 잡는다)
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({ note: z.string().max(4000).default("") }));
  return recordReview(ctx.admin, ctx.params.projectId, ctx.user.id, input.note);
});
