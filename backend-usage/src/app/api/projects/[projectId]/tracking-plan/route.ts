import { z } from "zod";
import { route, query, requireReader } from "@/lib/api/handler";
import { trackingPlan } from "@/lib/services/connections";

// 실사용 지표 추적 계획 내보내기 (yaml / csv)
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const { format } = query(ctx.req, z.object({ format: z.enum(["yaml", "csv"]).default("yaml") }));
  const file = await trackingPlan(ctx.admin, ctx.params.projectId, format);
  return new Response(file.body, {
    headers: { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"` },
  });
}, { auth: false });
