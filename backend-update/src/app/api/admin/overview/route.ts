import { route } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { serverEnv } from "@/lib/env";
import { gateStatus } from "@/lib/eval/sycophancy";
import { workbankStatus } from "@/lib/services/admin/quality";

export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  const env = serverEnv();
  const [gate, workbank, projects, requests] = await Promise.all([
    gateStatus(ctx.admin, env.ANTHROPIC_MODEL),
    workbankStatus(ctx.admin),
    ctx.admin.from("projects").select("id", { count: "exact", head: true }).eq("is_example", false),
    ctx.admin.from("mentor_requests").select("id", { count: "exact", head: true }).eq("status", "requested"),
  ]);
  return {
    gate,
    workbank,
    projects: projects.count ?? 0,
    pending_mentor_requests: requests.count ?? 0,
    config: {
      llm_provider: env.LLM_PROVIDER,
      model: env.ANTHROPIC_MODEL,
      voyage: !!env.VOYAGE_API_KEY,
      mail: !!env.RESEND_API_KEY,
      encryption_key: !!env.ENCRYPTION_KEY,
      cron_secret: !!env.CRON_SECRET,
      budget_krw: env.PROJECT_MONTHLY_LLM_BUDGET_KRW,
    },
  };
});
