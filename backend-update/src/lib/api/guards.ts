// 운영자 권한, 요청 제한, 예약 작업 보호
import "server-only";
import { ApiError, type Ctx } from "./handler";
import { isDemo, serverEnv } from "../env";
import type { Db } from "../supabase/server";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (isDemo() && email === "demo@example.com") return true;
  const list = serverEnv()
    .ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export function requireAdmin(ctx: Ctx<unknown>): void {
  if (!ctx.user) throw new ApiError(401, "unauthorized", "로그인이 필요하다");
  if (!isAdminEmail(ctx.user.email)) throw new ApiError(403, "forbidden", "운영자만 쓸 수 있다");
}

/** 요청 보낸 곳 (프록시 뒤라면 첫 번째 X-Forwarded-For) */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

/** DB에 둔 카운터로 요청 수를 제한한다 (서버가 여러 대여도 공유) */
export async function rateLimit(admin: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
  const { data, error } = await admin.rpc("consume_rate_limit", { k: key, lim: limit, window_seconds: windowSeconds });
  if (error) {
    console.error("[rate-limit]", error.message);
    return; // 제한 장치가 고장 나도 서비스는 계속한다
  }
  if (data === false) throw new ApiError(429, "rate_limited", "요청이 너무 많다. 잠시 뒤 다시 시도한다");
}

/** /api/cron/* : Authorization: Bearer <CRON_SECRET> (데모 모드는 로그인한 운영자도 허용) */
export function requireCron(req: Request, userEmail?: string | null): void {
  const secret = serverEnv().CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return;
  if (userEmail && isAdminEmail(userEmail)) return;
  throw new ApiError(401, "unauthorized", "예약 작업 인증 실패 (CRON_SECRET)");
}
