import { route } from "@/lib/api/handler";
import { rateLimit } from "@/lib/api/guards";
import { exportAccount } from "@/lib/services/account";

// 내 데이터 내려받기 (JSON)
export const GET = route(async (ctx) => {
  await rateLimit(ctx.admin, `export:${ctx.user.id}`, 5, 3600);
  const data = await exportAccount(ctx.admin, ctx.user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="verification-lab-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});
