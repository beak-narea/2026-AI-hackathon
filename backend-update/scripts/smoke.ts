// 배포 후 점검: 임시 사용자로 핵심 흐름을 한 바퀴 돈다 (가설 → 검증 제안 → 잠금 → 결과 → 판정 → 결정 → 추적 계획).
// LLM을 쓰는 단계(사업 모델 추출·가설 초안·기획서 초안)도 실제로 부른다. 비용을 줄이려면 서버를 LLM_PROVIDER=mock 으로 띄운다.
//
//   APP_URL=https://... NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/smoke.ts
import "./_env";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let token = "";
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return (res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as T;
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`✓ ${name} (${Date.now() - t}ms)`);
    return r;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e instanceof Error ? e.message : e}`);
    throw e;
  }
}

async function main() {
  const email = `smoke-${Date.now()}@example.com`;
  const password = `Smoke-${crypto.randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  let projectId = "";
  try {
    const { data: session, error: e2 } = await anon.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    token = session.session!.access_token;

    await step("헬스체크", () => call("GET", "/api/health"));
    const terms = await step("약관 상태", () => call("GET", "/api/auth/terms"));
    await step("약관 동의", () => call("POST", "/api/auth/terms", { terms: true, data_use: true, version: terms.current_version }));
    const project = await step("프로젝트 생성", () =>
      call("POST", "/api/projects", { name: "스모크 테스트", idea_text: "세무사 사무실 증빙 분류 AI", is_b2b: true }),
    );
    projectId = project.id;
    await step("사업 모델 추출", () => call("POST", `/api/projects/${projectId}/business-models/extract`, { text: "세무사 사무실 직원이 영수증을 손으로 분류한다. AI가 계정과목 초안을 만든다." }));
    const h = await step("가설 직접 입력", () =>
      call("POST", `/api/projects/${projectId}/hypotheses`, { statement: "세무사 사무실 실무자는 증빙 분류를 AI에 맡기길 원한다", type: "demand" }),
    );
    await step("중요도 평정", () => call("POST", `/api/projects/${projectId}/hypotheses/${h.id}/ratings`, { level: "critical", note: "" }));
    const methods = await step("실험 방법 목록", () => call("GET", `/api/projects/${projectId}/hypotheses/${h.id}/methods`));
    const gen = await step("검증 제안 생성", () =>
      call("POST", `/api/projects/${projectId}/proposals`, { hypothesis_id: h.id, method_key: methods.methods[0].key }),
    );
    const pid = gen.proposal.id;
    await step("기준 잠금", () => call("POST", `/api/projects/${projectId}/proposals/${pid}/lock`, { target_value: 0.4, min_value: 0.2, expected_rate: 0.5 }));
    await step("기획서 PDF", () => call("GET", `/api/projects/${projectId}/proposals/${pid}/pdf`));
    const sub = await step("결과 제출 → 판정", () =>
      call("POST", `/api/projects/${projectId}/proposals/${pid}/evidence`, {
        method_same: true, recruitment: "명부 무작위", attempts: 30, responses: 28, successes: 16,
        acquaintance_ratio: 0, same_company_count: 1, notice_given: true, memo: "smoke",
      }),
    );
    console.log(`  판정: ${sub.verdict.verdict?.result ?? sub.verdict.reason}`);
    await step("결정 기록", () =>
      call("POST", `/api/projects/${projectId}/decisions`, {
        hypothesis_id: h.id, verdict_id: sub.verdict.verdict.id, choice: "continue", reason_type: "evidence",
      }),
    );
    await step("추적 계획 YAML", () => call("GET", `/api/projects/${projectId}/tracking-plan?format=yaml`));
    await step("대시보드", () => call("GET", `/api/projects/${projectId}`));
    console.log("모든 단계 통과");
  } finally {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    await admin.auth.admin.deleteUser(created.user!.id);
  }
}

main().catch(() => process.exit(1));
