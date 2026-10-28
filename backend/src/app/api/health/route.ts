import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 배포 상태 확인 (로드밸런서·컨테이너 헬스체크용) */
export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString(), version: process.env.APP_VERSION ?? "dev" });
}
