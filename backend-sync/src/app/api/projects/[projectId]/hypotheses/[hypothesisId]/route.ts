import { z } from "zod";
import { route, body, must, requireEditor } from "@/lib/api/handler";
import { HYPOTHESIS_TYPES } from "@/lib/domain/rules";

type P = { projectId: string; hypothesisId: string };

export const PATCH = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const input = await body(
    ctx.req,
    z.object({ statement: z.string().min(5).max(1000).optional(), type: z.enum(HYPOTHESIS_TYPES).optional(), premortem_reason: z.string().max(2000).optional(),
      diagnosis_id: z.string().uuid().nullable().optional(),
      diagnosis_axis: z.enum(["feasibility", "demand", "buyer_demand"]).nullable().optional(),
    }),
  );
  if (input.diagnosis_id) {
    must(await ctx.admin.from("diagnoses").select("id").eq("id", input.diagnosis_id).eq("project_id", ctx.params.projectId).maybeSingle(), "진단");
  }
  // 문장·유형을 고쳤을 때만 "사람이 고친 가설"로 표시한다 (진단 연결만 바꾼 경우는 아니다)
  const wording = input.statement !== undefined || input.type !== undefined;
  const row = must(
    await ctx.admin
      .from("hypotheses")
      .update({ ...input, ...(wording ? { edited_by_user: true } : {}) })
      .eq("id", ctx.params.hypothesisId)
      .eq("project_id", ctx.params.projectId)
      .select("*")
      .single(),
  ) as Record<string, unknown>;
  // 사업 모델 칸에서 나온 가설이면 사업 모델 화면의 가설 문장도 같이 바꾼다
  if (input.statement && typeof row.source_field === "string") {
    const { data: bm } = await ctx.admin
      .from("business_models")
      .select("id, checks")
      .eq("project_id", ctx.params.projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bm && Array.isArray(bm.checks)) {
      const checks = (bm.checks as Array<Record<string, unknown>>).map((c) => (c.field === row.source_field ? { ...c, hypothesis: input.statement } : c));
      await ctx.admin.from("business_models").update({ checks }).eq("id", bm.id).eq("project_id", ctx.params.projectId);
    }
  }
  return row;
});

export const DELETE = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  const res = await ctx.admin
    .from("hypotheses")
    .delete()
    .eq("id", ctx.params.hypothesisId)
    .eq("project_id", ctx.params.projectId)
    .eq("status", "unverified")
    .select("id");
  if (!res.data?.length) {
    return Response.json({ error: { code: "conflict", message: "검증을 시작한 가설은 지울 수 없다" } }, { status: 409 });
  }
  return { removed: ctx.params.hypothesisId };
});
