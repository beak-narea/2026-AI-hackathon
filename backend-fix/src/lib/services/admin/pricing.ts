// 가격: Van Westendorp 공개 설문(진술 증거 L1)과 우리 서비스 비용 구조 (가격 하한·손익분기)
import "server-only";
import { z } from "zod";
import type { Db } from "../../supabase/server";
import { ApiError, conflict, must } from "../../api/handler";
import { vanWestendorp, VW_MIN_RESPONDENTS } from "../../cost/vanWestendorp";
import { selectAll } from "../../supabase/paging";
import {
  acceptableRangeBelowFloor, breakevenProgramsPerMonth, monthlyFixedCost, priceFloor, variableCostPerProgram,
  DEFAULT_TARGET_GROSS_MARGIN, AMORTIZATION_MONTHS,
} from "../../cost/ourService";

// ── 가격 설문 ──────────────────────────────────────────────────────
export async function createSurvey(admin: Db, input: { title: string; description?: string }) {
  return must(await admin.from("price_surveys").insert(input).select("*").single());
}

export async function setSurveyOpen(admin: Db, id: string, open: boolean) {
  return must(await admin.from("price_surveys").update({ open }).eq("id", id).select("*").single());
}

export async function surveyResults(admin: Db) {
  const surveys = must(await admin.from("price_surveys").select("*").order("created_at", { ascending: false })) as Array<{ id: string }>;
  const out = [];
  for (const s of surveys) {
    const rows = await selectAll<{ too_cheap: number; cheap: number; expensive: number; too_expensive: number }>((f, t) =>
      admin.from("price_responses").select("id, too_cheap, cheap, expensive, too_expensive").eq("survey_id", s.id).order("id").range(f, t),
    );
    const vw = vanWestendorp(rows.map((r) => ({ tooCheap: Number(r.too_cheap), cheap: Number(r.cheap), expensive: Number(r.expensive), tooExpensive: Number(r.too_expensive) })));
    out.push({ ...s, responses: rows.length, result: vw, min_respondents: VW_MIN_RESPONDENTS });
  }
  return { surveys: out };
}

export async function publicSurvey(admin: Db, token: string) {
  const s = must(await admin.from("price_surveys").select("id, title, description, open").eq("share_token", token).maybeSingle(), "설문");
  return { title: s.title, description: s.description, open: s.open };
}

export const PriceAnswer = z
  .object({
    respondent: z.string().trim().min(2).max(120),
    too_cheap: z.number().nonnegative().max(1e9),
    cheap: z.number().nonnegative().max(1e9),
    expensive: z.number().nonnegative().max(1e9),
    too_expensive: z.number().nonnegative().max(1e9),
  })
  .refine((a) => a.too_cheap <= a.cheap && a.cheap <= a.expensive && a.expensive <= a.too_expensive, {
    message: "너무 싸다 ≤ 싸다 ≤ 비싸다 ≤ 너무 비싸다 순서여야 한다",
  });

export async function submitAnswer(admin: Db, token: string, answer: z.infer<typeof PriceAnswer>) {
  const s = must(await admin.from("price_surveys").select("id, open").eq("share_token", token).maybeSingle(), "설문");
  if (!s.open) throw conflict("마감된 설문이다");
  const { error } = await admin.from("price_responses").insert({ survey_id: s.id, ...answer, respondent: answer.respondent.toLowerCase() });
  if (error?.code === "23505") throw new ApiError(409, "conflict", "이미 응답했다");
  if (error) throw error;
  return { ok: true };
}

// ── 우리 서비스 비용 구조 ─────────────────────────────────────────
export const CostSettings = z.object({
  monthlyPeople: z.number().nonnegative(),
  monthlyInfraFixed: z.number().nonnegative(),
  monthlyCodingCheck: z.number().nonnegative(),
  legalReviewOnce: z.number().nonnegative(),
  initialCodingValidationOnce: z.number().nonnegative(),
  sycophancyCheckPerRun: z.number().nonnegative(),
  sycophancyRunsPerYear: z.number().nonnegative(),
  storagePerProgram: z.number().nonnegative(),
  /** 실측이 없을 때 쓰는 프로그램당 LLM 비용 가정 */
  llmPerProgramAssumed: z.number().nonnegative(),
  targetGrossMargin: z.number().min(0).max(0.95),
  price: z.number().nonnegative(),
});
export type CostSettings = z.infer<typeof CostSettings>;

const DEFAULTS: CostSettings = {
  monthlyPeople: 3.5 * 6_000_000,
  monthlyInfraFixed: 300_000,
  monthlyCodingCheck: 400_000,
  legalReviewOnce: 5_000_000,
  initialCodingValidationOnce: 3_000_000,
  sycophancyCheckPerRun: 2_000_000,
  sycophancyRunsPerYear: 4,
  storagePerProgram: 2_000,
  llmPerProgramAssumed: 30_000,
  targetGrossMargin: DEFAULT_TARGET_GROSS_MARGIN,
  price: 0,
};

export async function getCostSettings(admin: Db): Promise<CostSettings> {
  const { data } = await admin.from("service_settings").select("value").eq("key", "cost_structure").maybeSingle();
  return { ...DEFAULTS, ...((data?.value as Partial<CostSettings>) ?? {}) };
}

export async function saveCostSettings(admin: Db, input: CostSettings) {
  must(await admin.from("service_settings").upsert({ key: "cost_structure", value: input, updated_at: new Date().toISOString() }, { onConflict: "key" }).select("key"));
  return ourCost(admin);
}

/** 실측 변동비: 최근 90일 동안 검증 제안을 1개 이상 잠근 프로젝트 기준 (프로그램 1회 ≈ 프로젝트 1개) */
async function measuredVariable(admin: Db) {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const projects = await selectAll<{ id: string }>((f, t) =>
    admin.from("projects").select("id").eq("is_example", false).gte("created_at", since).order("id").range(f, t),
  );
  const ids = new Set(projects.map((p) => p.id));
  if (!ids.size) return null;
  // id 목록을 주소에 넣지 않고, 기간으로 나눠 읽은 뒤 거른다
  const [calls, mentors] = await Promise.all([
    selectAll<{ project_id: string | null; purpose: string; cost_krw: number }>((f, t) =>
      admin.from("llm_calls").select("id, project_id, purpose, cost_krw").gte("created_at", since).order("id").range(f, t),
    ),
    selectAll<{ project_id: string; fee_krw: number; status: string }>((f, t) =>
      admin.from("mentor_requests").select("id, project_id, fee_krw, status").gte("created_at", since).order("id").range(f, t),
    ),
  ]);
  const rows = calls.filter((c) => c.project_id && ids.has(c.project_id));
  const baseline = rows.filter((r) => r.purpose === "baseline_test.generic").reduce((s, r) => s + Number(r.cost_krw), 0);
  const llm = rows.filter((r) => r.purpose !== "baseline_test.generic").reduce((s, r) => s + Number(r.cost_krw), 0);
  const fees = mentors.filter((m) => ids.has(m.project_id) && (m.status === "matched" || m.status === "done")).reduce((s, m) => s + Number(m.fee_krw), 0);
  return { projects: ids.size, llmCalls: llm / ids.size, baselineTests: baseline / ids.size, externalRaterFees: fees / ids.size };
}

export async function ourCost(admin: Db) {
  const s = await getCostSettings(admin);
  const measured = await measuredVariable(admin);
  const variable = {
    llmCalls: measured && measured.llmCalls > 0 ? measured.llmCalls : s.llmPerProgramAssumed,
    baselineTests: measured?.baselineTests ?? 0,
    externalRaterFees: measured?.externalRaterFees ?? 0,
    storage: s.storagePerProgram,
  };
  const varCost = variableCostPerProgram(variable);
  const floor = priceFloor(varCost, s.targetGrossMargin);
  const fixed = monthlyFixedCost(s);
  const { surveys } = await surveyResults(admin);
  const latest = surveys.find((x) => x.result.pmc !== null && x.result.pme !== null);
  const range = latest ? { low: latest.result.pmc!, high: latest.result.pme!, respondents: latest.result.respondents, enough: latest.result.enoughRespondents } : null;
  return {
    settings: s,
    measured,
    variable: { ...variable, total: varCost, source: measured && measured.llmCalls > 0 ? "실측 (최근 90일)" : "가정값" },
    price_floor: floor,
    monthly_fixed: fixed,
    amortization_months: AMORTIZATION_MONTHS,
    breakeven_programs: s.price > 0 ? breakevenProgramsPerMonth(fixed, s.price, varCost) : null,
    acceptable_range: range,
    range_below_floor: range ? acceptableRangeBelowFloor(range, floor) : null,
  };
}
