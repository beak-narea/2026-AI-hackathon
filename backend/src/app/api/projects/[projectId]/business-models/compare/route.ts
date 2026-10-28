import { z } from "zod";
import { route, query, requireReader } from "@/lib/api/handler";
import { compareVersions } from "@/lib/services/businessModel";

// business_model.compare?a=1&b=2
export const GET = route<{ projectId: string }>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const q = query(ctx.req, z.object({ a: z.coerce.number().int().positive(), b: z.coerce.number().int().positive() }));
  return compareVersions(ctx.admin, ctx.params.projectId, q.a, q.b);
}, { auth: false });
