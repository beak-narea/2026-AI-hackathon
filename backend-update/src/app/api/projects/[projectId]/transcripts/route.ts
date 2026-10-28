import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { analyzeTranscript } from "@/lib/services/evidence";

type P = { projectId: string };
export const maxDuration = 180;

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const transcripts = must(
    await ctx.admin.from("transcripts").select("*, insights(*)").eq("project_id", ctx.params.projectId).order("created_at", { ascending: false }),
  );
  return { transcripts };
}, { auth: false });

// 받은 전사본 분석 (진술 증거 L1: 판정이 아니라 다음 제안의 재료)
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      evidence_id: z.string().uuid().nullable().optional(),
      text: z.string().min(50).max(200_000),
      names: z.array(z.string()).max(200).optional(),
      companies: z.array(z.string()).max(200).optional(),
    }),
  );
  return analyzeTranscript(ctx.admin, ctx.params.projectId, ctx.user.id, input);
});
