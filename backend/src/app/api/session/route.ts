import { route } from "@/lib/api/handler";
import { isDemo, serverEnv } from "@/lib/env";
import { isAdminUser } from "@/lib/api/guards";

// 화면이 처음 열릴 때: 로그인 상태, 약관 동의 여부, 로그인 방식(데모 / Supabase)
export const GET = route(async (ctx) => {
  const env = serverEnv();
  let profile: { terms_version: string | null; data_use_accepted_at: string | null; display_name: string | null } | null = null;
  if (ctx.user) {
    const { data } = await ctx.admin.from("profiles").select("terms_version, data_use_accepted_at, display_name").eq("id", ctx.user.id).maybeSingle();
    profile = data;
  }
  return {
    mode: isDemo() ? "demo" : "supabase",
    user: ctx.user ? { id: ctx.user.id, email: ctx.user.email, name: profile?.display_name || (ctx.user.user_metadata?.name as string) || "" } : null,
    terms: {
      current_version: env.TERMS_VERSION,
      accepted: profile?.terms_version === env.TERMS_VERSION,
      data_use: !!profile?.data_use_accepted_at,
    },
    is_admin: isAdminUser(ctx.user),
    supabase: isDemo() ? null : { url: env.NEXT_PUBLIC_SUPABASE_URL, anon_key: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  };
}, { auth: false });
