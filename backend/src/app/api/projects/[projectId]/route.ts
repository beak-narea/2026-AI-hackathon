import { z } from "zod";
import { ApiError, route, body, forbidden, must, projectRole, requireEditor, requireReader } from "@/lib/api/handler";
import { dashboard, deleteProject } from "@/lib/services/projects";
import { cycleOf, projectWarnings } from "@/lib/services/review";
import { trackOnce } from "@/lib/services/admin/quality";

type P = { projectId: string };

// dashboard (예시 프로젝트는 로그인 없이도 볼 수 있다)
export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const { role, isExample } = await projectRole(ctx, ctx.params.projectId);
  // 설계 가정 추적: 예시 프로젝트를 본 사람
  if (isExample && ctx.user) await trackOnce(ctx.admin, ctx.user.id, "example_viewed").catch(() => {});
  const d = await dashboard(ctx.admin, ctx.params.projectId);
  const p = d.project as { review_cycle_weeks: number; last_reviewed_at: string | null; created_at: string };
  return { ...d, my_role: role, cycle: cycleOf(p), warnings: await projectWarnings(ctx.admin, ctx.params.projectId) };
}, { auth: false });

// project_settings: 이름·B2B 여부
export const PATCH = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({
      name: z.string().min(1).max(120).optional(),
      idea_text: z.string().max(20000).optional(),
      is_b2b: z.boolean().optional(),
      review_cycle_weeks: z.number().int().min(1).max(12).optional(),
      raw_retention_days: z.number().int().min(7).max(3650).optional(),
    }));
  return must(await ctx.admin.from("projects").update(input).eq("id", ctx.params.projectId).select("*").single());
});

// project.delete: 소유자만, 프로젝트 이름을 확인 문구로 (되돌릴 수 없다)
export const DELETE = route<P>(async (ctx) => {
  const { role, isExample } = await projectRole(ctx, ctx.params.projectId);
  if (isExample) throw new ApiError(403, "example_read_only", "예시 프로젝트는 지울 수 없다");
  if (role !== "owner") throw forbidden();
  const input = await body(ctx.req, z.object({ confirm: z.string().min(1).max(200) }));
  return deleteProject(ctx.admin, ctx.params.projectId, input.confirm);
});
