// 예시 프로젝트 시드 생성기: 숫자(표본 수, 결정표, 판정, 비용)를 서비스와 같은 코드로 계산해 seed.sql을 만든다.
// 실행: npx tsx scripts/generate-seed.ts > supabase/seed.sql
// 가상의 AI 스타트업 사례다. 실제 회사·인물이 아니다.

import { renameSync, writeFileSync } from "node:fs";
import { conclusionProbability, decisionTable, judge, requiredSampleSize } from "../src/lib/stats/verdict";
import { computeCostModel } from "../src/lib/cost/unitEconomics";
import { automationZone, baselineVerdict, recommend, wrapperRisk, isGroundedChange } from "../src/lib/domain/rules";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const q = (s: string | null | undefined) => (s === null || s === undefined ? "null" : `'${s.replace(/'/g, "''")}'`);
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const num = (v: number | null) => (v === null ? "null" : String(Number(v.toFixed(6))));

const P = id(1);
const out: string[] = [];
out.push("-- 예시 프로젝트 (가상 사례). scripts/generate-seed.ts로 생성 — 직접 고치지 말 것");
out.push("begin;");
out.push(`delete from public.projects where id = '${P}';`);

out.push(`insert into public.projects (id, owner_id, name, idea_text, is_example, is_b2b) values ('${P}', null,
  '예시 · 세무 증빙 자동 분류 AI',
  ${q("세무사 사무실 직원이 매달 수천 장씩 손으로 나누는 영수증·세금계산서를 AI가 계정과목별로 분류해 주는 서비스. 사무소의 기존 세무 프로그램으로 결과를 바로 보낸다.")},
  true, true);`);

// 사업 모델
const BM = id(10);
out.push(`insert into public.business_models (id, project_id, version, problem, customer_segments, unique_value_proposition, solution,
  channels, revenue_streams, cost_structure, key_metrics, unfair_advantage, extracted_by_llm, edited_by_user) values ('${BM}', '${P}', 1,
  ${q("기장 대행 사무소 직원이 증빙 분류에 월 40시간 이상을 쓴다. 성수기에는 야근으로 메운다.")},
  ${q("직원 5~30명 규모의 세무사 사무실 (실무자: 기장 담당 직원, 구매자: 대표 세무사)")},
  ${q("증빙을 올리면 계정과목 분류 초안이 나오고, 직원은 검토만 한다")},
  ${q("증빙 OCR + 분류 모델 + 사무소별 분류 이력 학습 + 세무 프로그램 내보내기")},
  ${q("세무사회 지역 모임, 세무 프로그램 판매 대리점 제휴")},
  ${q("사무소당 월 구독 (처리 건수 구간별)")},
  ${q("모델 호출 비용, 검수 인력, 영업")},
  ${q("직원 1인당 월 분류 시간, 분류 수정률")},
  ${q("사무소별로 쌓이는 분류 수정 이력")},
  true, true);`);
// 칸별 가설과 자료 점검 (충분함·부족함·없음)
const checks = [
  { field: "problem", hypothesis: "기장 담당 직원은 증빙 분류에 월 40시간 이상 쓴다", status: "enough", found: "월 40시간 이상, 성수기에는 야근으로 메운다는 구체적 서술", gap: "" },
  { field: "customer_segments", hypothesis: "직원 5~30명 세무사 사무실이 첫 고객이다", status: "enough", found: "규모와 실무자·구매자 구분이 있다", gap: "" },
  { field: "unique_value_proposition", hypothesis: "분류 초안을 검토만 하면 분류 시간이 절반 이하로 준다", status: "weak", found: "검토만 한다는 서술", gap: "검토 시간이 실제로 얼마나 주는지 측정이 없다" },
  { field: "solution", hypothesis: "OCR과 분류 모델로 사람이 고칠 일이 적은 초안을 만들 수 있다", status: "weak", found: "구성 요소 목록", gap: "사무소 증빙으로 잰 분류 정확도가 없다" },
  { field: "channels", hypothesis: "세무사회 지역 모임과 대리점 제휴로 사무소를 만날 수 있다", status: "weak", found: "채널 후보 두 가지", gap: "실제 연락·전환 기록이 없다" },
  { field: "revenue_streams", hypothesis: "대표 세무사가 처리 건수 구간별 월 구독료를 낸다", status: "weak", found: "월 구독 방식", gap: "가격과 지불 의향 근거가 없다" },
  { field: "cost_structure", hypothesis: "모델 호출·검수·영업 비용이 구독료 안에 들어온다", status: "weak", found: "비용 항목 목록", gap: "건당 비용과 손익분기 계산이 없다" },
  { field: "key_metrics", hypothesis: "직원 1인당 분류 시간과 수정률로 효과를 잴 수 있다", status: "enough", found: "측정 단위가 정해져 있다", gap: "" },
  { field: "unfair_advantage", hypothesis: "사무소별 수정 이력이 쌓이면 범용 AI보다 정확해진다", status: "weak", found: "수정 이력 축적", gap: "이력이 정확도를 얼마나 올리는지 근거가 없다" },
];
out.push(`update public.business_models set checks = ${q(JSON.stringify(checks))}::jsonb where id = '${BM}';`);

const tasks = [
  { n: 20, name: "영수증·세금계산서를 계정과목별로 분류", role: "practitioner" },
  { n: 21, name: "분류 결과 검토·수정", role: "practitioner" },
  { n: 22, name: "도입 비용 결재", role: "buyer" },
];
for (const [i, t] of tasks.entries()) {
  out.push(`insert into public.tasks (id, project_id, business_model_id, name, role, position) values ('${id(t.n)}', '${P}', '${BM}', ${q(t.name)}, '${t.role}', ${i});`);
}

// 기준선 테스트: 샘플 12개, 평가자 3명. 자사 결과가 10개 샘플에서 다수결 승리
const baselineVotes = Array.from({ length: 12 }, (_, s) =>
  ["평가자A", "평가자B", "평가자C"].map((e, k) => ({ sampleIndex: s, evaluator: e, choseOurs: s < 10 ? k !== 2 || s % 2 === 0 : k === 0 })),
).flat();
const baseline = baselineVerdict(baselineVotes);

// 진단
const D = id(30);
const wrapper = {
  proprietary_data: "yes", integration_depth: "yes", human_expertise: "yes",
  switching_cost: "unknown", regulatory_barrier: "no", bigtech_overlap: "unknown",
} as const;
const risk = wrapperRisk(wrapper, baseline.result);
const zone = automationZone({ verdict: baseline.result, level: "L3" }, { verdict: "met", level: "L2" });
out.push(`insert into public.diagnoses (id, project_id, task_id, business_model_id, zone, feasibility_level, demand_level, is_provisional,
  demand_prior, demand_prior_task, agency_assumed, agency_observed, baseline_win_rate, baseline_result, wrapper_risk, confirmation_questions)
  values ('${D}', '${P}', '${id(20)}', '${BM}', ${zone.zone ? `'${zone.zone}'` : "null"}, 'L3', 'L2', ${zone.provisional},
  3.9, ${q("Review and classify invoices and receipts (WORKBank 유사 업무, 참고용)")}, 'H1', 'H3', ${num(baseline.oursWins / baseline.samples)}, '${baseline.result}', '${risk}',
  ${j(["사무소가 요구하는 분류 정확도는 몇 %이고, 현재 프로토타입은 몇 %인가?", "직원이 분류 초안을 고치는 데 건당 몇 초가 드는가?"])});`);
const notes: Record<string, string> = {
  proprietary_data: "사무소별 분류 수정 이력이 쌓인다 (파일럿 3곳에서 월 2천 건)",
  integration_depth: "주요 세무 프로그램 2종으로 바로 내보내기",
  human_expertise: "세무사 검수 규칙이 분류 기준에 들어간다",
  switching_cost: "아직 확인 전",
  regulatory_barrier: "별도 인증 요건 없음",
  bigtech_overlap: "범용 모델 업체의 회계 기능 로드맵 확인 필요",
};
for (const [k, v] of Object.entries(wrapper)) {
  out.push(`insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('${P}', '${D}', '${k}', '${v}', ${q(notes[k])});`);
}

const BT = id(40);
out.push(`insert into public.baseline_tests (id, project_id, diagnosis_id, prompt_used, model, share_token) values ('${BT}', '${P}', '${D}',
  ${q("다음 증빙을 한국 기업회계 계정과목으로 분류하라.")}, 'generic-model', 'example-baseline-token');`);
for (let s = 0; s < 12; s++) {
  out.push(`insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('${id(400 + s)}', '${P}', '${BT}', ${s}, ${q(`증빙 샘플 ${s + 1} (가명 처리됨)`)}, ${q("분류 결과 A")}, ${q("분류 결과 B")}, ${s % 2 === 0});`);
}
for (const v of baselineVotes) {
  const aIsOurs = v.sampleIndex % 2 === 0;
  out.push(`insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('${P}', '${id(400 + v.sampleIndex)}', ${q(v.evaluator)}, ${v.choseOurs === aIsOurs});`);
}

// 비용 모델 (원 단위, 가상의 단가)
const costInputs = {
  tasksPerUser: 1500, callsPerTask: 1.2, inputTokens: 1800, outputTokens: 120,
  inputPricePerMTok: 4200, outputPricePerMTok: 21000, cacheSaving: 0.4, retryRate: 0.05,
  reviewHoursPerTask: 0, hourlyWage: 0, monthlyPrice: 150000,
};
const cost = computeCostModel(costInputs);
const CM = id(50);
out.push(`insert into public.cost_models (id, project_id, business_model_id, inputs, results) values ('${CM}', '${P}', '${BM}', ${j(costInputs)}, ${j(cost)});`);

// 가설
type H = { n: number; statement: string; type: string; crit: string; level: string; status: string; rank: number; pre?: string };
const hyps: H[] = [
  { n: 60, statement: "세무사 사무실 실무자는 증빙 분류를 AI에 맡기길 원한다", type: "demand", crit: "critical", level: "L2", status: "met", rank: 1,
    pre: "직원들이 AI 결과를 믿지 않아 결국 다시 손으로 분류했다" },
  { n: 61, statement: "사무소가 받아들이는 최소 분류 정확도는 95%다", type: "accuracy", crit: "critical", level: "L3", status: "in_progress", rank: 2,
    pre: "정확도가 기대에 못 미쳐 검토 시간이 오히려 늘었다" },
  { n: 62, statement: "대표 세무사는 8주 검증 파일럿에 선결제한다", type: "payment", crit: "critical", level: "L0", status: "in_progress", rank: 3 },
  { n: 63, statement: "실무자는 완전 자동 처리보다 AI 초안 후 직접 검토를 고른다", type: "preference", crit: "major", level: "L2", status: "met", rank: 4 },
  { n: 64, statement: "8주 안에 사무소 5곳에서 증빙 샘플 500건을 받을 수 있다", type: "data", crit: "major", level: "L0", status: "unverified", rank: 5 },
];
for (const h of hyps) {
  out.push(`insert into public.hypotheses (id, project_id, diagnosis_id, cost_model_id, statement, type, criticality, critical_candidate, evidence_level, rank, status, premortem_reason, drafted_by_llm, edited_by_user)
    values ('${id(h.n)}', '${P}', '${D}', '${CM}', ${q(h.statement)}, '${h.type}', '${h.crit}', false, '${h.level}', ${h.rank}, '${h.status}', ${q(h.pre ?? null)}, true, true);`);
}
const ratings: [number, string, string, string][] = [
  [60, "예시 팀원 1", "team", "critical"], [60, "예시 팀원 2", "team", "critical"], [60, "예시 멘토", "external", "critical"], [60, "LLM 반대 평가자", "llm", "major"],
  [61, "예시 팀원 1", "team", "critical"], [61, "예시 팀원 2", "team", "major"], [61, "예시 멘토", "external", "critical"], [61, "LLM 반대 평가자", "llm", "critical"],
  [63, "예시 팀원 1", "team", "major"], [63, "예시 팀원 2", "team", "major"], [63, "LLM 반대 평가자", "llm", "minor"],
];
for (const [h, name, type, level] of ratings) {
  out.push(`insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('${P}', '${id(h)}', ${q(name)}, '${type}', '${level}');`);
}

// 검증 제안 + 결과 + 판정 + 결정
interface Plan {
  n: number; h: number; methodKey: string; method: string; level: string; target: number; min: number; expected: number;
  status: string; evidence?: { attempts: number; responses: number; successes: number }; weeks: number; root?: number; look?: number;
  steps: string[]; mvp: string; recruitment: string;
}
const plans: Plan[] = [
  { n: 70, h: 60, methodKey: "b2b_followup_meeting", method: "문제 중심 연락 후 목적이 정해진 후속 미팅 요청", level: "L2", target: 0.4, min: 0.2, expected: 0.5,
    status: "received", evidence: { attempts: 28, responses: 28, successes: 16 }, weeks: 2,
    steps: ["목표 사무소 명단 30곳 작성 (지인 소개 제외)", "증빙 분류 시간 문제로 이메일 연락", "업무 흐름 관찰을 목적으로 30분 후속 미팅 요청", "수락·거절을 사무소 단위로 기록"],
    mvp: "개발 없음. 연락 문안과 미팅 안건만 준비", recruitment: "세무사회 지역 명부에서 무작위 추출" },
  { n: 71, h: 61, methodKey: "concierge_accuracy", method: "컨시어지: 정확도 수준을 달리한 수작업 분류 결과를 제공", level: "L3", target: 0.6, min: 0.4, expected: 0.7,
    status: "received", evidence: { attempts: 10, responses: 10, successes: 6 }, weeks: 2,
    steps: ["참여 사무소 10곳에 수작업 분류 결과를 제공 (수작업임을 미리 알림)", "사무소마다 정확도 90%·95% 결과를 번갈아 제공", "결과를 고치지 않고 장부에 반영한 비율 기록"],
    mvp: "구글 시트 + 사람이 만든 분류 결과", recruitment: "후속 미팅을 수락한 사무소 중 참여 동의" },
  { n: 72, h: 61, methodKey: "concierge_accuracy", method: "컨시어지: 표본을 늘린 재검증", level: "L3", target: 0.6, min: 0.4, expected: 0.7,
    status: "awaiting", weeks: 2, root: 71,
    steps: ["같은 방식으로 사무소 10곳 추가 모집", "이전 결과와 합쳐 다시 판정"], mvp: "이전과 같음", recruitment: "신규 사무소 10곳" },
  { n: 73, h: 62, methodKey: "paid_pilot", method: "유료 파일럿 제안 (예산 권한자 서명, 환불 불가, 사전 합의 성공 지표)", level: "L4", target: 0.25, min: 0.1, expected: 0.3,
    status: "sent", weeks: 2,
    steps: ["후속 미팅 사무소 대표에게 8주 파일럿 견적 발송", "성공 지표와 결정일을 문서로 합의", "결제 여부 기록"], mvp: "파일럿 계약서와 결제 링크", recruitment: "후속 미팅 수락 사무소" },
  { n: 74, h: 63, methodKey: "b2b_mode_choice", method: "데모 미팅에서 두 방식을 같은 가격으로 제시하고 파일럿 방식을 고르게 함", level: "L2", target: 0.6, min: 0.4, expected: 0.75,
    status: "received", evidence: { attempts: 16, responses: 16, successes: 13 }, weeks: 1,
    steps: ["데모 미팅에서 'AI가 자동 처리'와 'AI 초안 후 직접 검토' 두 안을 같은 가격으로 제시", "실제로 고른 방식을 기록"], mvp: "두 방식의 화면 시안", recruitment: "후속 미팅 수락 사무소" },
];

const verdictIds: Record<number, string> = {};
for (const p of plans) {
  const t = { target: p.target, min: p.min };
  const plan = requiredSampleSize(t, p.expected);
  const sample = plan?.n ?? null;
  const table = decisionTable([5, 10, 15, 20, 30], t);
  const cp = sample ? conclusionProbability(sample, t, p.expected).pConclusive : null;
  const rootCol = p.root ? `'${id(p.root)}'` : "null";
  out.push(`insert into public.proposals (id, project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, guide_steps,
    prerequisites, mvp_scope, recruitment, operating_rules, target_value, min_value, locked_at, expected_rate, sample_size, decision_table,
    conclusion_probability, expected_weeks, status, drafted_by_llm, edited_by_user) values ('${id(p.n)}', '${P}', '${id(p.h)}', ${rootCol}, '${p.methodKey}', ${q(p.method)}, '${p.level}',
    ${j(p.steps)}, ${j(p.methodKey.startsWith("concierge") ? ["사람이 만든 정답이 달린 증빙 샘플"] : [])}, ${q(p.mvp)}, ${q(p.recruitment)},
    ${j(["대상에게 사실대로 알린다", "결제·해지 같은 핵심 경로에는 가짜 기능을 쓰지 않는다"])}, ${p.target}, ${p.min}, now() - interval '20 days', ${p.expected},
    ${sample ?? "null"}, ${j(table)}, ${num(cp)}, ${p.weeks}, '${p.status}', true, true);`);

  if (p.evidence) {
    const E = id(p.n + 100);
    out.push(`insert into public.evidence (id, project_id, proposal_id, method_same, recruitment, attempts, responses, successes, raw_files, has_raw,
      acquaintance_ratio, same_company_count, notice_given, memo, evidence_level, effective_n, effective_successes, cluster_method)
      values ('${E}', '${P}', '${id(p.n)}', true, ${q(p.recruitment)}, ${p.evidence.attempts}, ${p.evidence.responses}, ${p.evidence.successes},
      ${j([{ name: "결과.csv", kind: "csv" }])}, true, 0, 1, true, '', '${p.level}', ${p.evidence.responses}, ${p.evidence.successes}, 'independent');`);
    const v = judge({ successes: p.evidence.successes, n: p.evidence.responses, ...t, look: 1 });
    const V = id(p.n + 200);
    verdictIds[p.h] = V;
    out.push(`insert into public.verdicts (id, project_id, hypothesis_id, proposal_id, root_proposal_id, evidence_ids, look_number, n, successes, raw_n,
      target_value, min_value, p_above_target, p_below_min, wilson_low, wilson_high, result, evidence_level)
      values ('${V}', '${P}', '${id(p.h)}', '${id(p.n)}', '${id(p.n)}', array['${E}']::uuid[], 1, ${v.n}, ${v.successes}, ${p.evidence.responses},
      ${p.target}, ${p.min}, ${num(v.pAboveTarget)}, ${num(v.pBelowMin)}, ${num(v.wilsonLow)}, ${num(v.wilsonHigh)}, '${v.result}', '${p.level}');`);
    const crit = hyps.find((h) => h.n === p.h)!.crit as "critical" | "major" | "minor";
    const rec = recommend(v.result, crit, false);
    const choice = v.result === "met" ? "continue" : "more_validation";
    const grounded = isGroundedChange({
      choice, reasonType: "evidence", verdictResult: v.result, verdictEvidenceLevel: p.level as "L2", linkedToHypothesisAndEvidence: true,
    });
    out.push(`insert into public.decisions (project_id, hypothesis_id, verdict_id, recommendation, rationale, choice, reason_type, note, decided_at, is_grounded_change)
      values ('${P}', '${id(p.h)}', '${V}', '${rec.recommendation}', ${q(rec.rationale)}, '${choice}', 'evidence', ${q(v.result === "met" ? "다음 가설로 넘어간다" : "표본을 늘려 다시 본다")}, now() - interval '5 days', ${grounded});`);
  }
}

// 지표 카드 (충족 → 계속을 고른 가설)
out.push(`insert into public.metric_cards (project_id, hypothesis_id, event_name, definition, target_value, min_value, locked_at, alert_rule)
  values ('${P}', '${id(60)}', 'classification_draft_accepted', ${q("분류 초안을 받은 사무소 중 그 주에 초안을 장부에 반영한 사무소 비율")}, 0.4, 0.2, now() - interval '3 days',
  ${q("2주 연속 최소 허용치(20%) 아래로 내려가면 알림")}),
  ('${P}', '${id(63)}', 'review_mode_selected', ${q("새 사무소가 온보딩에서 'AI 초안 후 직접 검토'를 고른 비율")}, 0.6, 0.4, now() - interval '3 days', ${q("월간 판정이 미달이면 알림")});`);

// 모델 단가표 (가상의 값, 운영팀이 월 1회 갱신)
out.push(`insert into public.price_table (model_name, input_per_mtok_krw, output_per_mtok_krw, cached_input_per_mtok_krw)
  values ('example-large', 4200, 21000, 420), ('example-small', 1400, 7000, 140) on conflict (model_name) do nothing;`);

out.push("commit;");
// --out 파일: 임시 파일에 다 쓴 뒤 바꿔 끼운다 (중간에 실패해도 기존 seed.sql이 비지 않게)
const outIdx = process.argv.indexOf("--out");
const target = outIdx >= 0 ? process.argv[outIdx + 1] : undefined;
if (target) {
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, out.join("\n") + "\n", "utf8");
  renameSync(tmp, target);
  console.error(`✓ ${target}`);
} else {
  console.log(out.join("\n"));
}
