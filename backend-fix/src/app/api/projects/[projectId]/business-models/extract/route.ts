import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { extractBusinessModel } from "@/lib/services/businessModel";

export const maxDuration = 300;

// business_model.extract: 텍스트·웹사이트·피치덱·사진 → Lean Canvas + 업무 목록 초안
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      text: z.string().max(20000).optional(),
      urls: z.array(z.string().url()).max(3).optional(),
      files: z.array(z.string()).max(8).optional(),
    }),
  );
  return extractBusinessModel(ctx.admin, ctx.params.projectId, ctx.user.id, input);
});
