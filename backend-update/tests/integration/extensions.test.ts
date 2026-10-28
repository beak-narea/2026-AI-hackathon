// 확장 기능: 경고·점검 주기, 4구역 자동 갱신, 피치 초안, 도구 연동, 알림, 원자료, 계정, 멘토 연결,
// 운영자 기능(성공 기준, 가격 설문, 비용 구조, 아첨 점검, 코딩 일치도, 품질 보고), 요청 제한·비용 상한, 예약 작업
process.env.DEMO_MODE = "1"; // 연동 가져오기를 외부 호출 없이 (데모 응답)
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "../db/migrate";
import { fakeSupabase } from "@/lib/dev/fakeSupabase";
import type { Db } from "@/lib/supabase/server";
import { createProject } from "@/lib/services/projects";
import { extractBusinessModel } from "@/lib/services/businessModel";
import { runDiagnosis } from "@/lib/services/diagnosis";
import { createHypothesis, rateCriticality } from "@/lib/services/hypotheses";
import { generateProposal, lockProposal } from "@/lib/services/proposals";
import { analyzeTranscript, submitEvidence, uploadRawFile, type EvidenceForm } from "@/lib/services/evidence";
import { recordDecision } from "@/lib/services/decisions";
import { lockMetricCard } from "@/lib/services/postLaunch";
import { projectWarnings, recordReview, reviewState } from "@/lib/services/review";
import { draftPitch } from "@/lib/services/pitch";
import { addIntegration, setMetricSource, syncProject } from "@/lib/services/sync";
import { listNotifications, markRead } from "@/lib/services/notifications";
import { deleteRawFile, listRawFiles, purgeExpiredRawFiles } from "@/lib/services/rawFiles";
import { deleteAccount, exportAccount } from "@/lib/services/account";
import { matchRequest, requestMentor, upsertMentor } from "@/lib/services/mentors";
import { cohortReport, createCohort, upsertTeam } from "@/lib/services/admin/cohorts";
import { createSurvey, ourCost, saveCostSettings, getCostSettings, submitAnswer, surveyResults } from "@/lib/services/admin/pricing";
import { computeCodeTypeStatus, createCodingSet, labelSegments, nextSegments, runLlmCoding } from "@/lib/services/coding";
import { gateStatus, runAndStore } from "@/lib/eval/sycophancy";
import { qualityReport } from "@/lib/services/admin/quality";
import { llmFor } from "@/lib/llm/factory";
import { rateLimit } from "@/lib/api/guards";
import { runDaily } from "@/lib/services/cron";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MENTOR_USER = "33333333-3333-4333-8333-333333333333";
const OTHER = "55555555-5555-4555-8555-555555555555";
let admin: Db;
let raw: Awaited<ReturnType<typeof freshDb>>;
let projectId: string;

const form = (o: Partial<EvidenceForm>): EvidenceForm => ({
  method_same: true, recruitment: "명부 무작위", attempts: 30, responses: 30, successes: 20, raw_files: [],
  acquaintance_ratio: 0, same_company_count: 1, notice_given: true, memo: "", ...o,
});
const q1 = async <T,>(sql: string) => (await raw.query<T>(sql)).rows[0]!;

beforeAll(async () => {
  raw = await freshDb({ postgrestTypes: true, seed: true });
  await raw.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@example.com'), ('${MENTOR_USER}', 'mentor@example.com'), ('${OTHER}', 'other@example.com')`);
  admin = (await fakeSupabase(raw)) as unknown as Db;
  projectId = (await createProject(admin, OWNER, { name: "확장 테스트", idea_text: "세무 증빙 분류", is_b2b: true })).id;
  await extractBusinessModel(admin, projectId, OWNER, { text: "세무사 사무실 증빙 분류 AI" });
});

describe("경고·점검 주기·4구역", () => {
  it("치명 가설에 제안이 없으면 경고, 점검을 기록하면 다음 점검일이 잡힌다", async () => {
    const h = await createHypothesis(admin, projectId, { statement: "사무소는 결과물을 고치지 않고 쓴다", type: "trust" });
    await raw.exec(`update public.hypotheses set criticality = 'critical' where id = '${h.id}'`);
    const w = await projectWarnings(admin, projectId);
    expect(w.map((x) => x.kind)).toEqual(expect.arrayContaining(["critical_without_proposal", "critical_without_external_rater"]));
    const before = await reviewState(admin, projectId);
    expect(before.cycle.last_reviewed_at).toBeNull();
    const r = await recordReview(admin, projectId, OWNER, "첫 점검");
    expect(r.cycle.last_reviewed_at).not.toBeNull();
    expect(r.cycle.overdue).toBe(false);
    expect((r.review.snapshot as { warnings: unknown[] }).warnings.length).toBeGreaterThan(0);
  });

  it("진단에 연결한 가설이 판정을 받으면 축이 채워지고, 실무자·구매자 수요가 엇갈리면 경고", async () => {
    const d = await runDiagnosis(admin, projectId, OWNER);
    const diagId = d.diagnoses[0]!.diagnosis.id as string;
    // 가능성 축: 정확도 가설 충족
    const fh = await createHypothesis(admin, projectId, { statement: "요구 정확도 90%를 넘는다", type: "accuracy" });
    await raw.exec(`update public.hypotheses set diagnosis_id = '${diagId}' where id = '${fh.id}'`);
    const fp = await generateProposal(admin, projectId, OWNER, { hypothesis_id: fh.id });
    await lockProposal(admin, projectId, fp.proposal.id, { target_value: 0.6, min_value: 0.4, expected_rate: 0.7 });
    const fr = await submitEvidence(admin, projectId, fp.proposal.id, OWNER, form({ successes: 27 }));
    expect(fr.verdict.judged && fr.verdict.verdict.result).toBe("met");
    // 수요 축: 미달 → 빨간불
    const dh = await createHypothesis(admin, projectId, { statement: "실무자가 후속 미팅을 수락한다", type: "demand" });
    await raw.exec(`update public.hypotheses set diagnosis_id = '${diagId}', diagnosis_axis = 'demand' where id = '${dh.id}'`);
    const dp = await generateProposal(admin, projectId, OWNER, { hypothesis_id: dh.id });
    await lockProposal(admin, projectId, dp.proposal.id, { target_value: 0.4, min_value: 0.2, expected_rate: 0.5 });
    const dr = await submitEvidence(admin, projectId, dp.proposal.id, OWNER, form({ successes: 2 }));
    expect(dr.verdict.judged && dr.verdict.verdict.result).toBe("not_met");
    expect(dr.verdict.judged && dr.verdict.zone).toBe("red");
    const diag = await q1<{ zone: string; feasibility_verdict: string; demand_verdict: string }>(`select zone, feasibility_verdict, demand_verdict from public.diagnoses where id = '${diagId}'`);
    expect(diag).toEqual({ zone: "red", feasibility_verdict: "met", demand_verdict: "not_met" });
    // 구매자 수요는 충족 → 엇갈림 경고
    await raw.exec(`update public.diagnoses set buyer_demand_verdict = 'met' where id = '${diagId}'`);
    expect((await projectWarnings(admin, projectId)).map((x) => x.kind)).toContain("demand_split");
    // 미달 판정은 팀에 알림
    const n = await listNotifications(admin, OWNER);
    expect(n.notifications.some((x: { kind: string }) => x.kind === "verdict_not_met")).toBe(true);
    await markRead(admin, OWNER, "all");
    expect((await listNotifications(admin, OWNER)).unread).toBe(0);
  });

  it("판정과 반대인 결정은 경고", async () => {
    const h = await q1<{ id: string }>(`select id from public.hypotheses where type = 'demand' and project_id = '${projectId}'`);
    const v = await q1<{ id: string }>(`select id from public.verdicts where hypothesis_id = '${h.id}'`);
    await recordDecision(admin, projectId, OWNER, { hypothesis_id: h.id, verdict_id: v.id, choice: "continue", reason_type: "other" });
    const kinds = (await projectWarnings(admin, projectId)).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["decision_against_evidence", "critical_unverified_but_continuing"]));
  });
});

describe("피치 초안·도구 연동", () => {
  it("판매 테스트용 피치 초안", async () => {
    const p = await q1<{ id: string }>(`select id from public.proposals where project_id = '${projectId}' limit 1`);
    const pitch = await draftPitch(admin, projectId, p.id, OWNER);
    expect((pitch.content as { headline: string }).headline).toBeTruthy();
  });

  it("PostHog 자격 증명은 암호화 저장, 지표 카드 이벤트로 가져와 재판정, Langfuse 비용은 겹치지 않게", async () => {
    const r = await addIntegration(admin, projectId, "posthog", { host: "https://us.posthog.com", project_id: "123", api_key: "phx_secret_key_123" });
    expect(r.test.ok).toBe(true);
    const sec = await q1<{ encrypted_config: string; token_hash: string | null }>(`select encrypted_config, token_hash from public.connection_secrets where connection_id = '${r.connection.id}'`);
    expect(sec.encrypted_config).toMatch(/^v1\./);
    expect(sec.encrypted_config).not.toContain("phx_secret");
    expect(JSON.stringify(r.connection.config)).not.toContain("phx_secret");
    await expect(addIntegration(admin, projectId, "amplitude", { api_key: "x" })).rejects.toThrow();

    // 충족 가설 → 지표 카드 → 잠금 → 이벤트 지정
    const fh = await q1<{ id: string }>(`select id from public.hypotheses where type = 'accuracy' and project_id = '${projectId}'`);
    const fv = await q1<{ id: string }>(`select id from public.verdicts where hypothesis_id = '${fh.id}'`);
    const dec = await recordDecision(admin, projectId, OWNER, { hypothesis_id: fh.id, verdict_id: fv.id, choice: "continue", reason_type: "evidence" });
    const card = (dec as unknown as { metric_card: { id: string } }).metric_card;
    await lockMetricCard(admin, projectId, card.id);
    await setMetricSource(admin, projectId, card.id, { numerator_event: "ai_output_adopted", denominator_event: "pageview", window_days: 30 });
    const s = await syncProject(admin, projectId);
    const m = s.results[0]!.metrics.find((x) => x.card_id === card.id)!;
    expect(m.n).toBe(80);
    expect(m.result).toBeTruthy();
    // 같은 날 두 번은 재지 않는다
    const again = await syncProject(admin, projectId);
    expect(again.results[0]!.metrics.find((x) => x.card_id === card.id)!.skipped).toMatch(/오늘/);

    const lf = await addIntegration(admin, projectId, "langfuse", { public_key: "pk-lf-1", secret_key: "sk-lf-1" });
    const c1 = await syncProject(admin, projectId, lf.connection.id);
    expect(c1.results[0]!.cost).toHaveProperty("total_cost_krw");
    const c2 = await syncProject(admin, projectId, lf.connection.id);
    expect(c2.results[0]!.cost).toHaveProperty("skipped");
  });
});

describe("원자료·전사본 코딩 판정·계정", () => {
  it("원자료 목록·삭제·보관 기간 정리", async () => {
    const p = await q1<{ id: string }>(`select id from public.proposals where project_id = '${projectId}' limit 1`);
    await uploadRawFile(admin, projectId, p.id, new File(["a,b\n1,2\n"], "a.csv", { type: "text/csv" }), {}, OWNER);
    const f2 = await uploadRawFile(admin, projectId, p.id, new File(["x\n"], "b.txt", { type: "text/plain" }), {}, OWNER);
    const list = await listRawFiles(admin, projectId);
    expect(list.files).toHaveLength(2);
    const target = list.files.find((f) => f.path === f2.path)!;
    await deleteRawFile(admin, projectId, target.id);
    const fake = admin as unknown as { _files: Map<string, Blob> };
    expect(fake._files.has(`raw-files/${f2.path}`)).toBe(false);
    await raw.exec(`update public.raw_files set created_at = now() - interval '400 days' where deleted_at is null`);
    expect((await purgeExpiredRawFiles(admin)).purged).toBe(1);
  });

  it("코드 유형이 자동 적용 기준을 넘지 못하면 인사이트는 검토 대상", async () => {
    const r = await analyzeTranscript(admin, projectId, OWNER, { text: "고객: 매달 증빙을 손으로 나눕니다. 시간이 너무 많이 들어요.\n인터뷰어: 지난번에는 어떻게 하셨어요?" });
    expect(r.insights[0]!.needs_review).toBe(true);
    expect(r.quality.validated).toBe(false);
  });

  it("멘토 연결: 요청 → 배정하면 외부 평가자로 초대·팀 알림 → 외부 평정", async () => {
    const h = await q1<{ id: string }>(`select id from public.hypotheses where type = 'trust' and project_id = '${projectId}'`);
    const req = await requestMentor(admin, projectId, OWNER, { hypothesis_id: h.id, topic: "치명 후보 평정" });
    const mentor = await upsertMentor(admin, { name: "김멘토", email: "mentor@example.com", organization: "제휴 액셀러레이터", fee_krw: 100000 });
    const m = await matchRequest(admin, req.id, mentor.id);
    expect(m.request.status).toBe("matched");
    const member = await q1<{ role: string; user_id: string }>(`select role, user_id from public.project_members where project_id = '${projectId}' and email = 'mentor@example.com'`);
    expect(member).toEqual({ role: "external_rater", user_id: MENTOR_USER });
    await rateCriticality(admin, projectId, h.id, { userId: MENTOR_USER, name: "김멘토", type: "external" }, "critical", "");
    expect((await projectWarnings(admin, projectId)).filter((w) => w.kind === "critical_without_external_rater" && w.target === h.id)).toHaveLength(0);
  });

  it("계정: 내보내기에는 가명 키가 없고, 삭제하면 프로젝트까지 지워진다", async () => {
    const p2 = await createProject(admin, OTHER, { name: "지울 프로젝트", idea_text: "", is_b2b: false });
    await createHypothesis(admin, p2.id, { statement: "지울 가설입니다", type: "demand" });
    const ex = await exportAccount(admin, OTHER);
    expect((ex.projects as unknown[]).length).toBe(1);
    expect(JSON.stringify(ex)).not.toContain("pseudonym_keys");
    await expect(deleteAccount(admin, OTHER, "삭제")).rejects.toThrow(/확인/);
    await deleteAccount(admin, OTHER, "계정 삭제");
    expect((await raw.query(`select 1 from public.projects where id = '${p2.id}'`)).rows).toHaveLength(0);
    expect((await raw.query(`select 1 from auth.users where id = '${OTHER}'`)).rows).toHaveLength(0);
  });
});

describe("운영자", () => {
  it("성공 기준: 기수 누적 판정, 근거 있는 결정과 선결제", async () => {
    const c1 = await createCohort(admin, { name: "1기", started_at: "2026-09-01" });
    await upsertTeam(admin, { cohort_id: c1.id, team_name: "팀A", project_id: projectId, offered_at: "2026-09-01", prepaid: true });
    await upsertTeam(admin, { cohort_id: c1.id, team_name: "팀B", offered_at: "2026-09-01", prepaid: false });
    await upsertTeam(admin, { cohort_id: c1.id, team_name: "팀C" });
    const c2 = await createCohort(admin, { name: "2기", started_at: "2026-10-01" });
    await upsertTeam(admin, { cohort_id: c2.id, team_name: "팀D", offered_at: "2026-10-01" });
    const r = await cohortReport(admin, new Date("2026-10-24"));
    expect(r.cohorts).toHaveLength(2);
    expect(r.cohorts[0]!.decision!.n).toBe(3);
    expect(r.cohorts[1]!.cumulative_teams).toBe(4);
    expect(r.cohorts[1]!.decision!.look).toBe(2);
    // 2기 팀D는 제안 후 2주가 지나 미결제로 센다, 팀C는 제안 전이라 지불 분모에서 빠진다
    expect(r.cohorts[1]!.payment!.n).toBe(3);
    expect(r.cohorts[1]!.payment!.k).toBe(1);
    expect(r.cohorts[1]!.payment_not_counted).toBe(1);
  });

  it("가격 설문 → Van Westendorp, 비용 구조 → 가격 하한·손익분기", async () => {
    const s = await createSurvey(admin, { title: "검증 프로그램 가격" });
    for (let i = 0; i < 16; i++) {
      await submitAnswer(admin, s.share_token, { respondent: `team${i}@x.com`, too_cheap: 50000 + i * 5000, cheap: 150000 + i * 5000, expensive: 400000 + i * 10000, too_expensive: 700000 + i * 10000 });
    }
    await expect(submitAnswer(admin, s.share_token, { respondent: "TEAM0@x.com", too_cheap: 1, cheap: 2, expensive: 3, too_expensive: 4 })).rejects.toThrow(/이미/);
    const res = await surveyResults(admin);
    expect(res.surveys[0]!.result.enoughRespondents).toBe(true);
    await saveCostSettings(admin, { ...(await getCostSettings(admin)), price: 990000 });
    const cost = await ourCost(admin);
    expect(cost.price_floor).toBeCloseTo(cost.variable.total / (1 - 0.52), 6);
    expect(cost.breakeven_programs).toBeGreaterThan(0);
    expect(cost.acceptable_range).not.toBeNull();
  });

  it("코딩 일치도: 구간 104개 미만이면 자동 적용하지 않는다", async () => {
    const text = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? `엑셀로 정리합니다 ${i}` : i % 3 === 1 ? `비용이 부담입니다 ${i}` : `그냥 일상 이야기 ${i}`)).join("\n\n");
    const set = await createCodingSet(admin, { name: "검증 세트", code_types: ["현재 해결 방법", "비용"], text });
    expect(set.segments).toBe(12);
    await runLlmCoding(admin, set.set.id, null);
    const next = await nextSegments(admin, set.set.id, OWNER, 50);
    await labelSegments(admin, set.set.id, OWNER, next.segments.map((s) => ({ segment_id: s.id, code_type: s.text.includes("엑셀") ? "현재 해결 방법" : s.text.includes("비용") ? "비용" : "없음" })));
    const st = await computeCodeTypeStatus(admin);
    const row = st.code_types.find((c) => c.code_type === "비용")!;
    expect(row.n_units).toBe(12);
    expect(row.status).toBe("off");
  });

  it("아첨 점검 3종 실행 → 채점기 미검증이면 배포 전 점검 실패", async () => {
    const llm = llmFor(admin, null, null);
    const f = await runAndStore(admin, llm, "mock-model", "framing");
    expect(f.metrics).toHaveProperty("mean_diff");
    const p = await runAndStore(admin, llm, "mock-model", "pushback");
    expect((p.metrics as { trials: number }).trials).toBe(60);
    expect(p.reasons.join()).toMatch(/채점기 미검증/);
    const w = await runAndStore(admin, llm, "mock-model", "weakness");
    expect((w.metrics as { total: number }).total).toBeGreaterThanOrEqual(45);
    expect(w.reasons.join()).toMatch(/전문가/);
    const gate = await gateStatus(admin, "mock-model");
    expect(gate.passed).toBe(false);
    expect(gate.kinds.find((k) => k.kind === "framing")!.passed).toBe(true);
    const other = await gateStatus(admin, "other-model");
    expect(other.kinds.every((k) => k.run_id === null)).toBe(true);
  });

  it("품질 보고: 예시 프로젝트는 빼고 계산", async () => {
    const r = await qualityReport(admin);
    expect(r.projects).toBe(1);
    expect(r.execution_fidelity.method_same.n).toBeGreaterThan(0);
    expect(r.criticality_scale.status).toBe("표본 부족");
  });
});

describe("요청 제한·비용 상한·예약 작업", () => {
  it("요청 제한", async () => {
    await rateLimit(admin, "t:1", 2, 60);
    await rateLimit(admin, "t:1", 2, 60);
    await expect(rateLimit(admin, "t:1", 2, 60)).rejects.toThrow(/너무 많다/);
  });

  it("프로젝트 월 LLM 비용 상한을 넘으면 호출하지 않는다", async () => {
    await raw.exec(`insert into public.llm_calls (project_id, purpose, prompt_version, model, cost_krw, ok) values ('${projectId}', 'x', 'x', 'x', 999999, true)`);
    await expect(llmFor(admin, projectId, OWNER).structured({ purpose: "pitch.draft", promptVersion: "x", system: "", user: "", schema: (await import("zod")).z.object({}), description: "" })).rejects.toThrow(/한도/);
  });

  it("매일 예약 작업", async () => {
    await raw.exec(`update public.projects set last_reviewed_at = now() - interval '30 days' where id = '${projectId}'`);
    const r = await runDaily(admin);
    expect(r.notified).toBeGreaterThan(0);
    const n = await listNotifications(admin, OWNER);
    expect(n.notifications.some((x: { kind: string }) => x.kind === "review_due")).toBe(true);
    const again = await runDaily(admin);
    const after = await listNotifications(admin, OWNER);
    expect(after.notifications.filter((x: { kind: string }) => x.kind === "review_due")).toHaveLength(1);
    expect(again).toHaveProperty("sync");
  });
});
