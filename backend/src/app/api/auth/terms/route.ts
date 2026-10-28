import { z } from "zod";
import { route, body, must } from "@/lib/api/handler";
import { serverEnv } from "@/lib/env";

// terms.accept: 이용약관과 데이터 활용·비식별 조항은 따로 동의받는다
export const POST = route(async (ctx) => {
  const input = await body(ctx.req, z.object({ terms: z.literal(true), data_use: z.boolean(), version: z.string() }));
  const env = serverEnv();
  if (input.version !== env.TERMS_VERSION) {
    return Response.json({ error: { code: "terms_outdated", message: "약관이 바뀌었다. 새 약관을 확인한다.", details: { version: env.TERMS_VERSION } } }, { status: 409 });
  }
  const now = new Date().toISOString();
  return must(
    await ctx.admin
      .from("profiles")
      .upsert({
        id: ctx.user.id,
        terms_version: input.version,
        terms_accepted_at: now,
        data_use_version: input.data_use ? input.version : null,
        data_use_accepted_at: input.data_use ? now : null,
      })
      .select("*")
      .single(),
  );
});

export const GET = route(async (ctx) => {
  const env = serverEnv();
  const { data } = await ctx.admin.from("profiles").select("*").eq("id", ctx.user.id).maybeSingle();
  return { current_version: env.TERMS_VERSION, profile: data, needs_acceptance: data?.terms_version !== env.TERMS_VERSION };
});
