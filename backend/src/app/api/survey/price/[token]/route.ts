import { route, body } from "@/lib/api/handler";
import { clientIp, rateLimit } from "@/lib/api/guards";
import { PriceAnswer, publicSurvey, submitAnswer } from "@/lib/services/admin/pricing";

type P = { token: string };

// 공개 가격 설문 (로그인 없음)
export const GET = route<P>(async (ctx) => publicSurvey(ctx.admin, ctx.params.token), { auth: false });

export const POST = route<P>(async (ctx) => {
  await rateLimit(ctx.admin, `price:${clientIp(ctx.req)}`, 10, 3600);
  const input = await body(ctx.req, PriceAnswer);
  return submitAnswer(ctx.admin, ctx.params.token, input);
}, { auth: false });
