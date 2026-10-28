// 서비스 전체 흐름: 실제 스키마·트리거(PGlite) + mock LLM 위에서 화면 순서대로 돈다.
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "../db/migrate";
import { fakeSupabase } from "@/lib/dev/fakeSupabase";
import type { Db } from "@/lib/supabase/server";
import { createProject, dashboard } from "@/lib/services/projects";
import { compareVersions, extractBusinessModel, saveVersion } from "@/lib/services/businessModel";
import { recalculate } from "@/lib/services/cost";
import { runDiagnosis, updateDiagnosis } from "@/lib/services/diagnosis";
import { applyBaseline, baselineResult, evaluatorView, startBaseline, submitVotes } from "@/lib/services/baseline";
import {
  createHypothesis, draftHypotheses, listHypotheses, rateCriticality, reorder, runDevilsAdvocate, settleCriticality,
} from "@/lib/services/hypotheses";
import { generateProposal, lockProposal, rejudgeProposal } from "@/lib/services/proposals";
import { analyzeTranscript, submitEvidence, uploadRawFile, type EvidenceForm } from "@/lib/services/evidence";
import { recordDecision } from "@/lib/services/decisions";
import { addConnection, lockMetricCard, recordObservation, trackingPlan } from "@/lib/services/postLaunch";
import { inviteMember } from "@/lib/services/members";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MATE = "22222222-2222-4222-8222-222222222222";
const MENTOR = "33333333-3333-4333-8333-333333333333";

let admin: Db;
let raw: Awaited<ReturnType<typeof freshDb>>;
let projectId: string;

const form = (o: Partial<EvidenceForm>): EvidenceForm => ({
  method_same: true,
  recruitment: "명부에서 무작위 추출",
  attempts: 30,
  responses: 28,
  successes: 16,
  raw_files: [],
  acquaintance_ratio: 0,
  same_company_count: 1,
  notice_given: true,
  memo: "",
  ...o,
});

beforeAll(async () => {
  raw = await freshDb({ postgrestTypes: true });
  await raw.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@example.com'), ('${MATE}', 'mate@example.com'), ('${MENTOR}', 'mentor@example.com');
    insert into public.price_table (model_name, input_per_mtok_krw, output_per_mtok_krw) values ('m-large', 4200, 21000);
  `);
  admin = (await fakeSupabase(raw)) as unknown as Db;
  const p = await createProject(admin, OWNER, { name: "통합 테스트", idea_text: "", is_b2b: false });
  projectId = p.id;
});

describe("만들기 전", () => {
  it("사업 모델 추출과 버전 비교", async () => {
    const r = await extractBusinessModel(admin, projectId, OWNER, { text: "세무사 사무실 증빙 분류 AI" });
    expect(r.business_model.version).toBe(1);
    expect(r.tasks).toHaveLength(3);
    const v2 = await saveVersion(admin, projectId, OWNER, { parent_version: 1, channels: "세무사회 모임" });
    expect(v2.version).toBe(2);
    expect(v2.problem).toBe(r.business_model.problem);
    const cmp = await compareVersions(admin, projectId, 1, 2);
    expect(cmp.changes.map((c) => c.field)).toEqual(["channels"]);
    const calls = await raw.query<{ n: number }>("select count(*)::int as n from public.llm_calls where ok");
    expect(calls.rows[0]!.n).toBeGreaterThan(0);
  });

  it("비용 계산기: 단가표에서 단가를 채운다", async () => {
    const r = await recalculate(admin, projectId, {
      model_name: "m-large", tasksPerUser: 100, callsPerTask: 2, inputTokens: 2000, outputTokens: 500, monthlyPrice: 30000,
    });
    expect(r.results.costPerTask.model).toBeCloseTo(2 * (2000 * 4200 + 500 * 21000) / 1e6, 6);
    expect(r.negative_margin).toBe(false);
  });

  it("진단과 대체 위험 등급", async () => {
    const d = await runDiagnosis(admin, projectId, OWNER);
    // mock 업무 3개 중 실무자 업무 2개
    expect(d.diagnoses).toHaveLength(2);
    const first = d.diagnoses[0]!;
    expect(first.wrapper_items).toHaveLength(6);
    expect(first.diagnosis.zone).toBeNull();
    const u = await updateDiagnosis(admin, projectId, first.diagnosis.id, {
      wrapper_items: [
        { item_key: "proprietary_data", status: "no" },
        { item_key: "integration_depth", status: "no" },
      ],
      agency_assumed: "H1",
      agency_observed: "H3",
    });
    expect(u.diagnosis.wrapper_risk).toBe("high");
    expect(u.suggestions.length).toBe(1);
  });

  it("블라인드 기준선 테스트: 평가자에게 출처를 숨기고 샘플당 다수결로 판정", async () => {
    const { diagnoses } = { diagnoses: (await raw.query<{ id: string }>("select id from public.diagnoses order by created_at")).rows };
    const samples = Array.from({ length: 10 }, (_, i) => ({ input: `증빙 ${i} 담당 김민수 대리 010-1234-5678`, ours: `분류 ${i}` }));
    const started = await startBaseline(admin, projectId, OWNER, { diagnosis_id: diagnoses[0]!.id, instruction: "계정과목으로 분류하라", samples });
    const token = started.evaluator_url.split("/").pop()!;
    const view = await evaluatorView(admin, token);
    expect(view.pairs).toHaveLength(10);
    expect(JSON.stringify(view)).not.toMatch(/a_is_ours|010-1234|김민수/);
    // 평가자 2명 모두 자사 결과를 고른다
    const pairs = (await raw.query<{ id: string; a_is_ours: boolean }>("select id, a_is_ours from public.baseline_pairs")).rows;
    for (const e of ["평가자1", "평가자2"]) {
      await submitVotes(admin, token, e, pairs.map((p) => ({ pair_id: p.id, chose_a: p.a_is_ours })));
    }
    await expect(submitVotes(admin, token, "평가자1", [{ pair_id: pairs[0]!.id, chose_a: true }])).rejects.toThrow(/이미/);
    const result = await baselineResult(admin, projectId, started.test.id);
    expect(result.oursWins).toBe(10);
    expect(result.result).toBe("met");
    // 판정 보기는 진단을 바꾸지 않는다
    const before = (await raw.query<{ baseline_result: string | null }>(`select baseline_result from public.diagnoses where id = '${diagnoses[0]!.id}'`)).rows[0]!;
    expect(before.baseline_result).toBeNull();
    await applyBaseline(admin, projectId, started.test.id);
    const d = (await raw.query<{ baseline_result: string; feasibility_level: string }>(`select baseline_result, feasibility_level from public.diagnoses where id = '${diagnoses[0]!.id}'`)).rows[0]!;
    expect(d).toEqual({ baseline_result: "met", feasibility_level: "L3" });
  });
});

describe("가설과 중요도", () => {
  let demandId: string;

  it("사전 부검 초안과 직접 입력", async () => {
    const drafts = await draftHypotheses(admin, projectId, OWNER);
    expect(drafts.hypotheses.length).toBe(3);
    expect(drafts.hypotheses.every((h: { criticality: unknown }) => h.criticality === null)).toBe(true);
    const h = await createHypothesis(admin, projectId, { statement: "실무자는 증빙 분류를 AI에 맡기길 원한다", type: "demand" });
    demandId = h.id;
  });

  it("독립 평정 → 치명은 외부 평가자 필요 → LLM 2단계 차이는 재검토", async () => {
    await raw.exec(`insert into public.project_members (project_id, user_id, email, role) values
      ('${projectId}', '${MATE}', 'mate@example.com', 'member'), ('${projectId}', '${MENTOR}', 'mentor@example.com', 'external_rater')`);
    let c = await rateCriticality(admin, projectId, demandId, { userId: OWNER, name: "대표", type: "team" }, "critical", "");
    c = await rateCriticality(admin, projectId, demandId, { userId: MATE, name: "팀원", type: "team" }, "critical", "");
    expect(c.consensus).toBe("critical");
    expect(c.needsExternalRater).toBe(true);
    await expect(settleCriticality(admin, projectId, demandId, "critical")).rejects.toThrow(/팀 밖 평가자/);
    // 같은 사람이 다시 매기면 덮어쓴다
    c = await rateCriticality(admin, projectId, demandId, { userId: MATE, name: "팀원", type: "team" }, "critical", "다시");
    c = await rateCriticality(admin, projectId, demandId, { userId: MENTOR, name: "멘토", type: "external" }, "critical", "");
    expect(c.needsExternalRater).toBe(false);
    expect(c.humanRaterCount).toBe(3);

    const da = await runDevilsAdvocate(admin, projectId, OWNER); // mock은 모두 "중대"
    expect(da.needs_review).toEqual([]);
    const order = await reorder(admin, projectId);
    expect(order[0]!.id).toBe(demandId);
    const list = await listHypotheses(admin, projectId);
    expect(list[0]!.ratings.length).toBe(4);
    expect(list[0]!.outside_view).toBeNull();
  });
});

describe("검증 → 판정 → 결정 → 출시 후", () => {
  let hId: string;
  let proposalId: string;
  let verdictId: string;

  it("기획서 생성 → 잠금 → 다시 잠그기·기준 변경 불가", async () => {
    hId = (await raw.query<{ id: string }>("select id from public.hypotheses where type = 'demand' order by created_at desc limit 1")).rows[0]!.id;
    const g = await generateProposal(admin, projectId, OWNER, { hypothesis_id: hId });
    proposalId = g.proposal.id;
    expect(g.proposal.method_key).toBe("fake_door");
    expect(g.proposal.locked_at).toBeNull();
    await expect(submitEvidence(admin, projectId, proposalId, OWNER, form({}))).rejects.toThrow(/잠근 뒤/);
    const l = await lockProposal(admin, projectId, proposalId, { target_value: 0.4, min_value: 0.2, expected_rate: 0.5 });
    expect(l.proposal.status).toBe("sent");
    expect(l.numbers.sample_size).toBeGreaterThan(20);
    await expect(lockProposal(admin, projectId, proposalId, { target_value: 0.3, min_value: 0.1, expected_rate: 0.5 })).rejects.toThrow(/이미/);
    const h = (await raw.query<{ status: string }>(`select status from public.hypotheses where id = '${hId}'`)).rows[0]!;
    expect(h.status).toBe("in_progress");
  });

  it("결과 제출 → 판정 (16/28, 목표 40% → 충족) → 같은 제안에 두 번 못 낸다", async () => {
    const r = await submitEvidence(admin, projectId, proposalId, OWNER, form({ acquaintance_ratio: 0.5 }));
    expect(r.evidence.evidence_level).toBe("L2");
    expect(r.evidence.quality_flags).toEqual(expect.arrayContaining(["원자료 없음", "지인·기존 고객 비율 50%"]));
    expect(r.verdict.judged).toBe(true);
    if (!r.verdict.judged) return;
    expect(r.verdict.verdict.result).toBe("met");
    verdictId = r.verdict.verdict.id;
    await expect(submitEvidence(admin, projectId, proposalId, OWNER, form({}))).rejects.toThrow(/이미 제출/);
  });

  it("결정: 계속 → 가설 충족, 지표 카드 생성", async () => {
    const d = await recordDecision(admin, projectId, OWNER, { hypothesis_id: hId, verdict_id: verdictId, choice: "continue", reason_type: "evidence" });
    expect(d.decision.recommendation).toBe("continue");
    expect(d.is_grounded_change).toBe(false);
    expect((d as { metric_card?: { event_name: string } }).metric_card?.event_name).toBe("ai_feature_used");
    const h = (await raw.query<{ status: string }>(`select status from public.hypotheses where id = '${hId}'`)).rows[0]!;
    expect(h.status).toBe("met");
  });

  it("출시 후: 잠금 → 관측 미달 → 가설 재검증 필요, 추적 계획 내보내기", async () => {
    const card = (await raw.query<{ id: string }>("select id from public.metric_cards")).rows[0]!;
    await expect(recordObservation(admin, projectId, card.id, { successes: 1, n: 10 })).rejects.toThrow(/잠근 뒤/);
    const locked = await lockMetricCard(admin, projectId, card.id);
    expect(locked.relocked).toBe(false);
    const o = await recordObservation(admin, projectId, card.id, { successes: 3, n: 40 });
    expect(o.verdict.result).toBe("not_met");
    const h = (await raw.query<{ status: string }>(`select status from public.hypotheses where id = '${hId}'`)).rows[0]!;
    expect(h.status).toBe("needs_recheck");
    const yaml = await trackingPlan(admin, projectId, "yaml");
    expect(yaml.body).toContain("ai_feature_used");
    const csv = await trackingPlan(admin, projectId, "csv");
    expect(csv.body.startsWith("﻿name,description")).toBe(true);
  });

  it("판정 보류 → 재판정 사슬 (기준 상속, 증거 누적)", async () => {
    const h = await createHypothesis(admin, projectId, { statement: "고객은 결과물을 고치지 않고 쓴다", type: "trust" });
    const g = await generateProposal(admin, projectId, OWNER, { hypothesis_id: h.id });
    await lockProposal(admin, projectId, g.proposal.id, { target_value: 0.6, min_value: 0.4, expected_rate: 0.7 });
    const first = await submitEvidence(admin, projectId, g.proposal.id, OWNER, form({ attempts: 10, responses: 10, successes: 5 }));
    expect(first.verdict.judged && first.verdict.verdict.result).toBe("on_hold");
    const re = await rejudgeProposal(admin, projectId, g.proposal.id);
    expect(re.proposal.look_number).toBe(2);
    expect(re.proposal.target_value).toBe(0.6);
    expect(re.additional_sample).toBeGreaterThan(0);
    const second = await submitEvidence(admin, projectId, re.proposal.id, OWNER, form({ attempts: 20, responses: 20, successes: 18 }));
    if (!second.verdict.judged) throw new Error("판정 안 됨");
    expect(second.verdict.verdict.n).toBe(30);
    expect(second.verdict.verdict.successes).toBe(23);
    expect(second.verdict.verdict.look_number).toBe(2);
    expect(second.verdict.verdict.result).toBe("met");
  });

  it("지불 의향 가설은 L4가 아니면 판정하지 않는다", async () => {
    const h = await createHypothesis(admin, projectId, { statement: "사무소는 선결제한다", type: "payment" });
    const g = await generateProposal(admin, projectId, OWNER, { hypothesis_id: h.id });
    await lockProposal(admin, projectId, g.proposal.id, { target_value: 0.25, min_value: 0.1, expected_rate: 0.3 });
    const r = await submitEvidence(admin, projectId, g.proposal.id, OWNER, form({ method_same: false, method_diff_reason: "설문으로 대신함", actual_kind: "survey" }));
    expect(r.evidence.evidence_level).toBe("L1");
    expect(r.verdict.judged).toBe(false);
  });
});

describe("원자료·전사본·연결·멤버·중단", () => {
  it("원자료는 가명 처리해서 저장하고 키는 따로 둔다", async () => {
    const pid = (await raw.query<{ id: string }>("select id from public.proposals limit 1")).rows[0]!.id;
    const file = new File(["이름,이메일\n박지영 님,jy@example.com\n"], "결과.csv", { type: "text/csv" });
    const r = await uploadRawFile(admin, projectId, pid, file, { names: ["박지영"] });
    const fake = admin as unknown as { _files: Map<string, Blob> };
    const stored = await fake._files.get(`raw-files/${r.path}`)!.text();
    expect(stored).not.toMatch(/박지영|jy@example.com/);
    const keys = await raw.query<{ original: string }>("select original from public.pseudonym_keys");
    expect(keys.rows.map((k) => k.original)).toEqual(expect.arrayContaining(["박지영", "jy@example.com"]));
  });

  it("전사본: 이전 가명을 이어 쓰고, 인용은 원문 대조를 통과한 것만", async () => {
    const r = await analyzeTranscript(admin, projectId, OWNER, {
      text: "고객: 박지영 님이 매달 증빙을 손으로 나눕니다. 시간이 너무 많이 들어요.\n인터뷰어: 지난번에는 어떻게 하셨어요?",
    });
    expect(r.transcript.pseudonymized_text).toContain("[이름1]");
    expect(r.insights.length).toBe(1);
    expect(r.dropped_insights).toBe(0);
  });

  it("데이터 연결 토큰은 해시로만 저장", async () => {
    const c = await addConnection(admin, projectId, { tool_name: "PostHog", kind: "analytics" });
    expect(c.ingest_token).toMatch(/^vs_/);
    const s = (await raw.query<{ token_hash: string }>("select token_hash from public.connection_secrets")).rows[0]!;
    expect(s.token_hash).not.toContain(c.ingest_token);
  });

  it("가입한 사용자를 초대하면 바로 연결된다", async () => {
    await raw.exec(`insert into auth.users (id, email) values ('44444444-4444-4444-8444-444444444444', 'late@example.com')`);
    const r = await inviteMember(admin, projectId, { email: "late@example.com", name: "늦게 온 사람", role: "member" });
    expect(r.member.user_id).toBe("44444444-4444-4444-8444-444444444444");
    await expect(inviteMember(admin, projectId, { email: "late@example.com", name: "", role: "member" })).rejects.toThrow(/이미/);
  });

  it("대시보드와 중단 결정 → 보관함", async () => {
    const dash = await dashboard(admin, projectId);
    expect(Object.keys(dash.hypothesis_status_counts).length).toBeGreaterThan(0);
    const h = (await raw.query<{ id: string }>("select id from public.hypotheses where type = 'payment'")).rows[0]!;
    const d = await recordDecision(admin, projectId, OWNER, { hypothesis_id: h.id, choice: "stop", reason_type: "external", note: "자금 사정" });
    expect(d.is_grounded_change).toBe(false);
    const p = (await raw.query<{ status: string; archive_reason: string }>(`select status, archive_reason from public.projects where id = '${projectId}'`)).rows[0]!;
    expect(p).toEqual({ status: "archived", archive_reason: "자금 사정" });
  });
});
