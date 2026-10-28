import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";
import { CANVAS_FIELDS, saveVersion } from "@/lib/services/businessModel";

type P = { projectId: string };

// business_model: 버전 목록과 업무
export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const versions = must(
    await ctx.admin.from("business_models").select("*, tasks(*)").eq("project_id", ctx.params.projectId).order("version", { ascending: false }),
  );
  return { versions };
}, { auth: false });

const canvas = Object.fromEntries(CANVAS_FIELDS.map((f) => [f, z.string().max(5000).optional()]));

// business_model.save_version
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({
      ...canvas,
      parent_version: z.number().int().positive().optional(),
      variant_label: z.string().max(100).optional(),
      tasks: z.array(z.object({ name: z.string().min(2), role: z.enum(["practitioner", "buyer"]) })).max(10).optional(),
    }),
  );
  return saveVersion(ctx.admin, ctx.params.projectId, ctx.user.id, input as never);
});
