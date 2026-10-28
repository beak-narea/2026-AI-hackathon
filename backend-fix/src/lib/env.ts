// 환경 변수: 서버 시작 시 한 번 검증한다. 클라이언트로 나가는 값은 NEXT_PUBLIC_ 만.
import { z } from "zod";

const ServerEnv = z.object({
  /** 1이면 Supabase 없이 PGlite로 도는 로컬 데모 (데이터는 서버를 끄면 사라진다) */
  DEMO_MODE: z.enum(["0", "1"]).default("0"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  /** 범용 모델 기준선 테스트에 쓰는 모델 (단순 프롬프트) */
  BASELINE_MODEL: z.string().default("claude-haiku-5-5"),
  /** LLM 호출 비용 기록용 단가 (원 / 100만 토큰) */
  LLM_INPUT_PRICE_PER_MTOK_KRW: z.coerce.number().default(4200),
  LLM_OUTPUT_PRICE_PER_MTOK_KRW: z.coerce.number().default(21000),
  /** mock = 외부 호출 없이 고정 응답 (로컬 개발·데모용) */
  LLM_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** WORKBank 유사 업무 검색용 임베딩 (선택). 없으면 수요 사전값을 비워 둔다 */
  VOYAGE_API_KEY: z.string().min(10).optional(),
  VOYAGE_MODEL: z.string().default("voyage-3.5"),
  TERMS_VERSION: z.string().default("2026-10-24"),
  /** 운영자 화면에 들어올 수 있는 이메일 (쉼표로 구분) */
  ADMIN_EMAILS: z.string().default(""),
  /** 연동 도구 자격 증명 암호화 키 (32바이트 이상 아무 문자열. 바꾸면 기존 연동을 다시 넣어야 한다) */
  ENCRYPTION_KEY: z.string().min(32).optional(),
  /** 예약 작업 라우트(/api/cron/*) 보호용. Vercel Cron은 Authorization: Bearer <값>으로 보낸다 */
  CRON_SECRET: z.string().min(16).optional(),
  /** 메일 알림 (선택). 없으면 화면 알림만 보낸다 */
  RESEND_API_KEY: z.string().min(10).optional(),
  MAIL_FROM: z.string().default("검증실 <noreply@example.com>"),
  /** Langfuse 비용(USD)을 원화로 바꿀 환율 */
  USD_KRW: z.coerce.number().positive().default(1400),
  /** 프로젝트당 월 LLM 비용 상한 (원). 0이면 상한 없음 */
  PROJECT_MONTHLY_LLM_BUDGET_KRW: z.coerce.number().nonnegative().default(50000),
  /** 사용자당 시간당 LLM 호출 수 상한 (진단 1회 = 업무 수만큼 호출) */
  LLM_CALLS_PER_HOUR: z.coerce.number().int().positive().default(120),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

let cached: ServerEnv | null = null;

const OPTIONAL_FEATURE_KEYS = ["ENCRYPTION_KEY", "CRON_SECRET", "RESEND_API_KEY", "VOYAGE_API_KEY", "MAIL_FROM", "USD_KRW"];

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  // .env 파일의 "KEY=" 처럼 비어 있는 값은 설정하지 않은 것으로 본다 (빈 문자열이 "N자 이상" 검사에 걸려 서버 전체가 멈추지 않게)
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  let parsed = ServerEnv.safeParse(raw);
  // 선택 기능의 값만 잘못됐으면 그 기능만 끄고 서버는 띄운다 (npm run doctor 가 알려 준다)
  if (!parsed.success) {
    const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    if ([...bad].every((k) => OPTIONAL_FEATURE_KEYS.includes(k))) {
      for (const k of bad) {
        console.warn(`[env] ${k} 값이 올바르지 않아 이 기능을 끈다`);
        delete raw[k];
      }
      parsed = ServerEnv.safeParse(raw);
    }
  }
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`환경 변수 설정 오류: ${missing} (.env.example 참고)`);
  }
  const d = parsed.data;
  if (d.DEMO_MODE !== "1" && (!d.NEXT_PUBLIC_SUPABASE_URL || !d.NEXT_PUBLIC_SUPABASE_ANON_KEY || !d.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("환경 변수 설정 오류: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (.env.example 참고)");
  }
  if (d.DEMO_MODE === "1" && !raw.LLM_PROVIDER) d.LLM_PROVIDER = "mock";
  if (parsed.data.LLM_PROVIDER === "anthropic" && !parsed.data.ANTHROPIC_API_KEY) {
    throw new Error("LLM_PROVIDER=anthropic 이면 ANTHROPIC_API_KEY가 필요하다");
  }
  cached = parsed.data;
  return cached;
}

export const isDemo = () => process.env.DEMO_MODE === "1";

/** 선택 기능 키 확인용 (빈 문자열은 없는 것으로) */
export const hasEnv = (k: string) => !!process.env[k]?.trim();
