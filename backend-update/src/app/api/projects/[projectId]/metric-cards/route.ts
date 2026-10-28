import { z } from "zod";
import { route, body, must, requireEditor, requireReader } from "@/lib/api/handler";

type P = { projectId: string };
const Rate = z.number().gt(0).lt(1);

export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  const cards = must(
    await ctx.admin.from("metric_cards").select("*, metric_observations(*)").eq("project_id", ctx.params.projectId).order("created_at"),
  );
  return { metric_cards: cards };
}, { auth: false });

// metric_card.create: 충족 판정을 받은 가설에만
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z
      .object({
        hypothesis_id: z.string().uuid(),
        event_name: z.string().regex(/^[a-z][a-z0-9_]*$/, "소문자·숫자·밑줄만"),
        definition: z.string().min(5).max(2000),
        target_value: Rate,
        min_value: Rate,
        alert_rule: z.string().max(500).default(""),
      })
      .refine((v) => v.target_value > v.min_value, { message: "목표값은 최소 허용치보다 커야 한다" }),
  );
  const h = must(
    await ctx.admin.from("hypotheses").select("status").eq("id", input.hypothesis_id).eq("project_id", ctx.params.projectId).maybeSingle(),
    "가설",
  );
  if (h.status !== "met") {
    return Response.json({ error: { code: "conflict", message: "충족 판정을 받은 가설에만 지표 카드를 만든다" } }, { status: 409 });
  }
  return must(await ctx.admin.from("metric_cards").insert({ ...input, project_id: ctx.params.projectId }).select("*").single());
});
