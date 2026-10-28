import { z } from "zod";
import { route, body, requireEditor } from "@/lib/api/handler";
import { addIntegration } from "@/lib/services/sync";
import { PROVIDERS } from "@/lib/integrations/providers";

// integration.add: PostHog·Amplitude·Langfuse 자격 증명 (암호화해 저장, 다시 보여주지 않는다)
export const POST = route<{ projectId: string }>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(ctx.req, z.object({ provider: z.enum(PROVIDERS), config: z.record(z.string(), z.unknown()) }));
  return addIntegration(ctx.admin, ctx.params.projectId, input.provider, input.config);
});
