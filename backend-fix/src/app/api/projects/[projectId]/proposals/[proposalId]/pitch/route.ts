import { route, requireEditor, requireReader } from "@/lib/api/handler";
import { draftPitch, listPitches } from "@/lib/services/pitch";

type P = { projectId: string; proposalId: string };
export const maxDuration = 300;

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return listPitches(ctx.admin, ctx.params.projectId, ctx.params.proposalId);
}, { auth: false });

// pitch.draft ⏳ 판매 테스트용 피치·데모 초안
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return draftPitch(ctx.admin, ctx.params.projectId, ctx.params.proposalId, ctx.user.id);
});
