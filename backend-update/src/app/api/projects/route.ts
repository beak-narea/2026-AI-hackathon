import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { createProject, listProjects } from "@/lib/services/projects";

// project_list
export const GET = route(async (ctx) => listProjects(ctx.admin, ctx.user.id));

// project.create
export const POST = route(async (ctx) => {
  const input = await body(
    ctx.req,
    z.object({ name: z.string().min(1).max(120), idea_text: z.string().max(20000).default(""), is_b2b: z.boolean().default(false) }),
  );
  const { data: profile } = await ctx.admin.from("profiles").select("terms_accepted_at").eq("id", ctx.user.id).maybeSingle();
  if (!profile?.terms_accepted_at) {
    return Response.json({ error: { code: "terms_required", message: "약관에 동의해야 프로젝트를 만들 수 있다" } }, { status: 403 });
  }
  return createProject(ctx.admin, ctx.user.id, input);
});
