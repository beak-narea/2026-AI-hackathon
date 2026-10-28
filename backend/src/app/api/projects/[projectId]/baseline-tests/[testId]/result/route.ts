import { route, requireEditor, requireReader } from "@/lib/api/handler";
import { applyBaseline, baselineResult } from "@/lib/services/baseline";

type P = { projectId: string; testId: string };

// 기준선 테스트 판정 보기 (샘플당 다수결, 목표값 70%, 최소 허용치 50%). 읽기만 한다.
export const GET = route<P>(async (ctx) => {
  await requireReader(ctx, ctx.params.projectId);
  return baselineResult(ctx.admin, ctx.params.projectId, ctx.params.testId);
}, { auth: false });

// baseline_test.apply: 판정을 진단의 가능성 축에 반영 (편집자만)
export const POST = route<P>(async (ctx) => {
  await requireEditor(ctx, ctx.params.projectId);
  return applyBaseline(ctx.admin, ctx.params.projectId, ctx.params.testId);
});
