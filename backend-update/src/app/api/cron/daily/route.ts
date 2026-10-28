import { route } from "@/lib/api/handler";
import { requireCron } from "@/lib/api/guards";
import { runDaily } from "@/lib/services/cron";

export const maxDuration = 300;

// 매일 한 번: 연동 가져오기·재판정, 기한 알림, 원자료 보관 기간 정리
// Vercel Cron은 GET에 Authorization: Bearer <CRON_SECRET>을 붙인다. 다른 서버는 curl로 같은 요청을 보낸다.
const handler = route(async (ctx) => {
  requireCron(ctx.req, ctx.user?.email);
  return runDaily(ctx.admin);
}, { auth: false });

export const GET = handler;
export const POST = handler;
