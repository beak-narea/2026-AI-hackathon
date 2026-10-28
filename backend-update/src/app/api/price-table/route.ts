import { route } from "@/lib/api/handler";
import { priceTable } from "@/lib/services/cost";

export const GET = route(async (ctx) => ({ models: await priceTable(ctx.admin) }), { auth: false });
