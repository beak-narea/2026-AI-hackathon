import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { serverEnv } from "@/lib/env";
import { createProject, listProjects } from "@/lib/services/projects";

// project_list
export const GET = route(async (ctx) => listProjects(ctx.admin, ctx.user.id));

// project.create
export const POST = route(async (ctx) => {
  const input = await body(
    ctx.req,
    z.object({ name: z.string().min(1).max(120), idea_text: z.string().max(20000).default(""), is_b2b: z.boolean().default(false) }),
  );
  const { data: profile } = await ctx.admin.from("profiles").select("terms_accepted_at, terms_version").eq("id", ctx.user.id).maybeSingle();
  if (!profile?.terms_accepted_at) {
    return Response.json({ error: { code: "terms_required", message: "약관에 동의해야 프로젝트를 만들 수 있다" } }, { status: 403 });
  }
  // 약관이 바뀌었으면 새 약관에 다시 동의해야 한다
  if (profile.terms_version !== serverEnv().TERMS_VERSION) {
    return Response.json({ error: { code: "terms_outdated", message: "약관이 바뀌었다. 로그인 화면에서 새 약관을 확인한다" } }, { status: 409 });
  }
  return createProject(ctx.admin, ctx.user.id, input);
});
