import { z } from "zod";
import { route, body } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/guards";
import { createCodingSet, listCoding } from "@/lib/services/coding";

export const GET = route(async (ctx) => {
  requireAdmin(ctx);
  return listCoding(ctx.admin);
});

// 코딩 세트 만들기: 구간은 빈 줄로 나눈다
export const POST = route(async (ctx) => {
  requireAdmin(ctx);
  const input = await body(ctx.req, z.object({ name: z.string().min(1).max(120), code_types: z.array(z.string().min(1).max(60)).min(1).max(20), text: z.string().min(5).max(500_000) }));
  return createCodingSet(ctx.admin, input);
});
