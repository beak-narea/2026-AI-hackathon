import { route } from "@/lib/api/handler";
import { evaluatorView } from "@/lib/services/baseline";

// 평가자용 공개 링크: 출처를 가린 결과 쌍
export const GET = route<{ token: string }>(async (ctx) => evaluatorView(ctx.admin, ctx.params.token), { auth: false });
