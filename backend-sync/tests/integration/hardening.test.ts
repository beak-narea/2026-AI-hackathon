// 코드 검토에서 나온 문제들이 다시 생기지 않는지 (회귀 테스트)
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "../db/migrate";
import { fakeSupabase } from "@/lib/dev/fakeSupabase";
import type { Db } from "@/lib/supabase/server";
import { createProject } from "@/lib/services/projects";
import { extractBusinessModel, normalizeChecks, recheckVersion, saveVersion } from "@/lib/services/businessModel";
import { methodsFor } from "@/lib/domain/experiments";
import { runDiagnosis as runDiag } from "@/lib/services/diagnosis";
import { runDiagnosis } from "@/lib/services/diagnosis";
import { startBaseline, submitVotes, applyBaseline, baselineResult } from "@/lib/services/baseline";
import { createHypothesis, listHypotheses, rateCriticality, settleCriticality } from "@/lib/services/hypotheses";
import { generateProposal, lockProposal, rejudgeProposal } from "@/lib/services/proposals";
import { EvidenceForm, submitEvidence, uploadRawFile, type EvidenceForm as Form } from "@/lib/services/evidence";
import { recordDecision } from "@/lib/services/decisions";
import { gatherMaterial } from "@/lib/services/sources";
import { monthlyLlmCost, llmFor } from "@/lib/llm/factory";
import { purgeExpiredRawFiles } from "@/lib/services/rawFiles";
import { PosthogConfig, LangfuseConfig } from "@/lib/integrations/providers";
import { isPrivateAddress } from "@/lib/net/safeFetch";
import { clientIp } from "@/lib/api/guards";
import { analyzeTranscript } from "@/lib/services/evidence";
import { removeConnection } from "@/lib/services/postLaunch";
import { monthStart } from "@/lib/llm/factory";
import { z } from "zod";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const RATER = "33333333-3333-4333-8333-333333333333";
let admin: Db;
let raw: Awaited<ReturnType<typeof freshDb>>;
let pa: string; // 공격자 프로젝트
let pb: string; // 피해 프로젝트
const form = (o: Partial<Form>): Form => ({
  method_same: true, recruitment: "명부 무작위", attempts: 10, responses: 10, successes: 5, raw_files: [],
  acquaintance_ratio: 0, same_company_count: 1, notice_given: true, memo: "", ...o,
});
const q1 = async <T,>(sql: string) => (await raw.query<T>(sql)).rows[0]!;

beforeAll(async () => {
  raw = await freshDb({ postgrestTypes: true });
  await raw.exec(`insert into auth.users (id, email) values ('${A}', 'a@x.com'), ('${B}', 'b@x.com'), ('${RATER}', 'r@x.com')`);
  admin = (await fakeSupabase(raw)) as unknown as Db;
  pa = (await createProject(admin, A, { name: "A", idea_text: "", is_b2b: false })).id;
  pb = (await createProject(admin, B, { name: "B", idea_text: "", is_b2b: false })).id;
  await extractBusinessModel(admin, pb, B, { text: "피해 프로젝트 아이디어" });
  await runDiagnosis(admin, pb, B);
});

describe("다른 프로젝트 데이터에 쓰기 차단", () => {
  it("기준선 테스트에 남의 진단을 걸 수 없고, 판정 보기는 진단을 바꾸지 않는다", async () => {
    const victim = await q1<{ id: string }>(`select id from public.diagnoses where project_id = '${pb}' limit 1`);
    const samples = Array.from({ length: 10 }, (_, i) => ({ input: `입력 ${i}`, ours: `결과 ${i}` }));
    await expect(startBaseline(admin, pa, A, { diagnosis_id: victim.id, instruction: "x", samples })).rejects.toThrow(/진단/);
    const own = await startBaseline(admin, pa, A, { instruction: "x", samples });
    const token = own.evaluator_url.split("/").pop()!;
    const pairs = (await raw.query<{ id: string }>(`select id from public.baseline_pairs where test_id = '${own.test.id}'`)).rows;
    await submitVotes(admin, token, "평가자", pairs.map((p) => ({ pair_id: p.id, chose_a: true })));
    await baselineResult(admin, pa, own.test.id);
    // 진단에 연결하지 않았으므로 반영할 것이 없다
    expect((await applyBaseline(admin, pa, own.test.id)).applied).toBe(false);
    const v = await q1<{ baseline_result: string | null }>(`select baseline_result from public.diagnoses where id = '${victim.id}'`);
    expect(v.baseline_result).toBeNull();
    await expect(submitVotes(admin, token, "평가자2", [{ pair_id: pairs[0]!.id, chose_a: true }, { pair_id: pairs[0]!.id, chose_a: false }])).rejects.toThrow(/두 번/);
  });

  it("남의 가설 중요도를 확정할 수 없다", async () => {
    const h = await createHypothesis(admin, pb, { statement: "피해 가설입니다", type: "demand" });
    await expect(settleCriticality(admin, pa, h.id, "minor")).rejects.toThrow(/가설/);
  });

  it("원본 자료 경로 조작으로 다른 파일을 읽을 수 없다", async () => {
    await expect(gatherMaterial(admin, pa, { files: [`${pa}/../../raw-files/${pb}/x.csv`] })).rejects.toThrow(/이 프로젝트에 올린 파일/);
    await expect(gatherMaterial(admin, pa, { files: [`${pa}/없는파일.pdf`] })).rejects.toThrow(/이 프로젝트에 올린 파일/);
  });

  it("원자료는 이 프로젝트의 제안에만 올린다", async () => {
    const other = await q1<{ id: string }>(`select id from public.diagnoses limit 1`);
    await expect(uploadRawFile(admin, pa, other.id, new File(["a"], "a.csv", { type: "text/csv" }), {})).rejects.toThrow(/검증 제안/);
  });
});

describe("데이터가 꼬이지 않게", () => {
  let hId: string;
  let proposalId: string;
  it("성공한 묶음 수가 묶음 수보다 크면 폼에서 거절하고, 제안은 막히지 않는다", async () => {
    const h = await createHypothesis(admin, pa, { statement: "고객은 결과물을 고치지 않고 쓴다", type: "trust" });
    hId = h.id;
    const g = await generateProposal(admin, pa, A, { hypothesis_id: h.id });
    proposalId = g.proposal.id;
    await lockProposal(admin, pa, proposalId, { target_value: 0.6, min_value: 0.4, expected_rate: 0.7 });
    expect(() => EvidenceForm.parse(form({ clusters: 3, cluster_successes: 5 }))).toThrow(/묶음/);
    // 폼 검사를 건너뛰어도 저장 전에 막는다
    await expect(submitEvidence(admin, pa, proposalId, A, form({ clusters: 3, cluster_successes: 5 }))).rejects.toThrow(/유효 표본/);
    expect((await raw.query(`select 1 from public.evidence where proposal_id = '${proposalId}'`)).rows).toHaveLength(0);
    const ok = await submitEvidence(admin, pa, proposalId, A, form({}));
    expect(ok.verdict.judged && ok.verdict.verdict.result).toBe("on_hold");
  });

  it("재판정은 기다리는 제안이 있으면 또 만들 수 없다", async () => {
    const first = await rejudgeProposal(admin, pa, proposalId);
    expect(first.proposal.look_number).toBe(2);
    await expect(rejudgeProposal(admin, pa, proposalId)).rejects.toThrow(/기다리고/);
    await expect(rejudgeProposal(admin, pa, first.proposal.id)).rejects.toThrow(/기다리고/);
  });

  it("재판정을 동시에 두 번 눌러도 회차는 하나만 생긴다", async () => {
    const h = await createHypothesis(admin, pa, { statement: "동시 재판정 확인용", type: "trust" });
    const g = await generateProposal(admin, pa, A, { hypothesis_id: h.id });
    await lockProposal(admin, pa, g.proposal.id, { target_value: 0.6, min_value: 0.4, expected_rate: 0.7 });
    await submitEvidence(admin, pa, g.proposal.id, A, form({}));
    const res = await Promise.allSettled([rejudgeProposal(admin, pa, g.proposal.id), rejudgeProposal(admin, pa, g.proposal.id)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await raw.query(`select 1 from public.proposals where root_proposal_id = '${g.proposal.id}'`)).rows).toHaveLength(1);
  });

  it("결정은 가장 최근 판정에만 연결한다", async () => {
    const child = await q1<{ id: string }>(`select id from public.proposals where root_proposal_id = '${proposalId}'`);
    const old = await q1<{ id: string }>(`select id from public.verdicts where hypothesis_id = '${hId}'`);
    await submitEvidence(admin, pa, child.id, A, form({ attempts: 30, responses: 30, successes: 27 }));
    await expect(recordDecision(admin, pa, A, { hypothesis_id: hId, verdict_id: old.id, choice: "continue", reason_type: "evidence" })).rejects.toThrow(/최근 판정/);
    const latest = await q1<{ id: string }>(`select id from public.verdicts where hypothesis_id = '${hId}' order by created_at desc limit 1`);
    const d1 = await recordDecision(admin, pa, A, { hypothesis_id: hId, verdict_id: latest.id, choice: "continue", reason_type: "evidence" });
    const d2 = await recordDecision(admin, pa, A, { hypothesis_id: hId, verdict_id: latest.id, choice: "continue", reason_type: "evidence" });
    expect((d2 as unknown as { metric_card: { id: string } }).metric_card.id).toBe((d1 as unknown as { metric_card: { id: string } }).metric_card.id);
    expect((await raw.query(`select 1 from public.metric_cards where hypothesis_id = '${hId}'`)).rows).toHaveLength(1);
  });

  it("업무를 모두 지우고 저장하면 업무 없이 저장된다", async () => {
    const v = await saveVersion(admin, pb, B, { parent_version: 1, tasks: [] });
    expect((await raw.query(`select 1 from public.tasks where business_model_id = '${v.id}'`)).rows).toHaveLength(0);
    const v2 = await saveVersion(admin, pb, B, { parent_version: 1 });
    expect((await raw.query(`select 1 from public.tasks where business_model_id = '${v2.id}'`)).rows.length).toBeGreaterThan(0);
  });

  it("같은 사업 모델로 진단을 다시 돌려도 진단이 쌓이지 않는다", async () => {
    const before = (await raw.query(`select 1 from public.diagnoses where project_id = '${pb}'`)).rows.length;
    await extractBusinessModel(admin, pb, B, { text: "새 버전" });
    await runDiagnosis(admin, pb, B);
    const mid = (await raw.query(`select 1 from public.diagnoses where project_id = '${pb}'`)).rows.length;
    const again = await runDiagnosis(admin, pb, B);
    expect(again.diagnoses).toHaveLength(0);
    expect((await raw.query(`select 1 from public.diagnoses where project_id = '${pb}'`)).rows.length).toBe(mid);
    expect(mid).toBeGreaterThan(before);
  });
});

describe("실제 Supabase와 다르게 동작하던 곳", () => {
  it("한글 파일명도 저장소 경로는 영문이라 올라가고, 원래 이름은 목록에 남는다", async () => {
    const g = await generateProposal(admin, pa, A, { hypothesis_id: (await createHypothesis(admin, pa, { statement: "업로드 확인용", type: "demand" })).id });
    const r = await uploadRawFile(admin, pa, g.proposal.id, new File(["이름,답\n김철수,예"], "인터뷰 결과(1차).csv", { type: "text/csv" }), { names: ["김철수"] });
    expect(r.path).toMatch(/^[A-Za-z0-9_/.-]+$/);
    expect(r.name).toBe("인터뷰 결과(1차).csv");
    expect(r.kind).toBe("csv");
  });

  it("가명 키가 1000개를 넘어도 새 토큰이 겹치지 않고, 같은 사람은 같은 토큰", async () => {
    await raw.exec(`insert into public.pseudonym_keys (project_id, token, original, kind)
                    select '${pb}', '[이메일' || g || ']', 'e' || g || '@x.com', 'email' from generate_series(1, 1100) g`);
    const t = await analyzeTranscript(admin, pb, B, { text: "연락처는 new-person@x.com 이고 예전 e1050@x.com 도 씀" });
    const text = JSON.stringify(t);
    expect(text).toContain("[이메일1050]");
    expect(text).toContain("[이메일1101]");
    const k = await q1<{ original: string }>(`select original from public.pseudonym_keys where project_id = '${pb}' and token = '[이메일1101]'`);
    expect(k.original).toBe("new-person@x.com");
  });

  it("평가자 수 상한은 일부 항목만 고른 평가자도 센다", async () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ input: `입력 ${i}`, ours: `결과 ${i}` }));
    const t = await startBaseline(admin, pa, A, { instruction: "x", samples });
    const token = t.evaluator_url.split("/").pop()!;
    const pairs = (await raw.query<{ id: string }>(`select id from public.baseline_pairs where test_id = '${t.test.id}' order by sample_index`)).rows;
    await raw.exec(`insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a)
                    select '${pa}', '${pairs[1]!.id}', 'bot' || g, true from generate_series(1, 100) g`);
    await expect(submitVotes(admin, token, "새 평가자", [{ pair_id: pairs[1]!.id, chose_a: true }])).rejects.toThrow(/상한/);
  });

  it("요청자가 꾸민 헤더로 요청 수 제한을 피하지 못한다", () => {
    const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
    expect(clientIp(req({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("없는 연결을 지우면 404", async () => {
    await expect(removeConnection(admin, pa, "00000000-0000-4000-8000-0000000000ff")).rejects.toThrow(/찾을 수 없|없/);
  });

  it("월 AI 사용 한도는 한국 시간 1일 0시에 바뀐다", () => {
    expect(monthStart(new Date("2026-10-31T16:00:00Z"))).toBe("2026-10-31T15:00:00.000Z");
    expect(monthStart(new Date("2026-11-01T14:59:00Z"))).toBe("2026-10-31T15:00:00.000Z");
  });
});

describe("블라인드 평정", () => {
  it("아직 매기지 않은 평가자에게는 다른 사람의 평정과 합의 값을 보내지 않는다", async () => {
    await raw.exec(`insert into public.project_members (project_id, user_id, email, role) values ('${pa}', '${RATER}', 'r@x.com', 'external_rater')`);
    const h = await createHypothesis(admin, pa, { statement: "블라인드 확인용 가설", type: "data" });
    await rateCriticality(admin, pa, h.id, { userId: A, name: "A", type: "team" }, "critical", "비밀 메모");
    const forRater = (await listHypotheses(admin, pa, { userId: RATER, canRate: true })).find((x) => x.id === h.id)!;
    expect(forRater.ratings).toHaveLength(0);
    expect(forRater.ratings_hidden).toBe(1);
    expect(JSON.stringify(forRater)).not.toContain("비밀 메모");
    // 순서·순위로도 합의 값을 드러내지 않는다
    expect(forRater.rank).toBeNull();
    // 평정자 계정 id는 누구에게도 내보내지 않는다
    expect(JSON.stringify(await listHypotheses(admin, pa, { userId: null, canRate: false }))).not.toContain(A);
    await rateCriticality(admin, pa, h.id, { userId: RATER, name: "R", type: "external" }, "major", "");
    const after = (await listHypotheses(admin, pa, { userId: RATER, canRate: true })).find((x) => x.id === h.id)!;
    expect(after.ratings).toHaveLength(2);
  });
});

describe("응답 1000행 제한", () => {
  it("월 AI 비용 합계는 1000건을 넘어도 정확하다 (한도가 작동한다)", async () => {
    await raw.exec(`insert into public.llm_calls (project_id, purpose, prompt_version, model, cost_krw, ok)
                    select '${pb}', 'x', 'x', 'x', 40, true from generate_series(1, 1500)`);
    expect(await monthlyLlmCost(admin, pb)).toBeGreaterThanOrEqual(60_000);
    await expect(
      llmFor(admin, pb, B).structured({ purpose: "pitch.draft", promptVersion: "x", system: "", user: "", schema: z.object({}), description: "" }),
    ).rejects.toThrow(/한도/);
  });

  it("보관 기간 정리는 100개씩 끝까지 지운다", async () => {
    await raw.exec(`insert into public.raw_files (project_id, path, name, kind, created_at)
                    select '${pb}', '${pb}/f' || g || '.csv', 'f.csv', 'csv', now() - interval '400 days' from generate_series(1, 450) g`);
    const r = await purgeExpiredRawFiles(admin);
    expect(r.purged).toBe(450);
  });
});

describe("연동 주소 검사 (SSRF)", () => {
  it("내부 주소·http·경로 꼼수를 거절하고 origin만 남긴다", () => {
    for (const host of ["http://169.254.169.254/x?", "https://10.0.0.5", "https://localhost", "https://svc#", "https://[::ffff:a9fe:a9fe]", "https://127.0.0.1:8080"]) {
      expect(PosthogConfig.safeParse({ host, project_id: "1", api_key: "phx_1234567890" }).success, host).toBe(false);
    }
    const ok = LangfuseConfig.parse({ host: "https://cloud.langfuse.com/api?x#y", public_key: "pk-1234", secret_key: "sk-1234" });
    expect(ok.host).toBe("https://cloud.langfuse.com");
    expect(isPrivateAddress("::ffff:10.1.2.3")).toBe(true);
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateAddress("8.8.4.4")).toBe(false);
  });
});

describe("업로드 결과: 가설별 자료 점검 (충분함·부족함·없음)", () => {
  it("9칸마다 가설과 세 단계 점검이 붙고, 빈 칸은 없음이다", async () => {
    const r = await extractBusinessModel(admin, pa, A, { text: "점검 확인용 아이디어 설명입니다" });
    const checks = r.business_model.checks as Array<{ field: string; status: string; hypothesis: string }>;
    expect(checks).toHaveLength(9);
    expect(new Set(checks.map((c) => c.status))).toEqual(new Set(["enough", "weak", "missing"]));
    expect(checks.find((c) => c.field === "channels")!.status).toBe("missing");
    expect(r.business_model.channels).toBe("");
    expect(checks.every((c) => c.hypothesis.length > 0)).toBe(true);
  });

  it("LLM이 칸 내용과 어긋나게 매겨도 맞춘다: 빈 칸은 없음, 채운 칸은 없음이 아니다", () => {
    const fixed = normalizeChecks({ problem: "", solution: "있다" }, [
      { field: "problem", hypothesis: "h", status: "enough", found: "x", gap: "" },
      { field: "solution", hypothesis: "h", status: "missing", found: "", gap: "" },
    ]);
    expect(fixed.find((c) => c.field === "problem")!.status).toBe("missing");
    expect(fixed.find((c) => c.field === "solution")!.status).toBe("weak");
    expect(fixed).toHaveLength(9);
  });

  it("고친 칸은 다시 점검 표시가 붙고, 다시 점검하면 사라진다", async () => {
    const latest = await q1<{ version: number }>(`select max(version) as version from public.business_models where project_id = '${pa}'`);
    const v = await saveVersion(admin, pa, A, { parent_version: latest.version, channels: "세무사회 지역 모임" });
    const ch = (v.checks as Array<{ field: string; status: string; stale?: boolean }>).find((c) => c.field === "channels")!;
    expect(ch.status).toBe("weak");
    expect(ch.stale).toBe(true);
    const re = await recheckVersion(admin, pa, A, v.version as number);
    expect((re.checks as Array<{ stale?: boolean }>).some((c) => c.stale)).toBe(false);
  });
});

describe("가설 화면·진단과 같은 정리", () => {
  it("업로드하면 칸마다 가설이 가설 화면에 바로 생기고, 모두 실험 방법이 있다", async () => {
    const pc = (await createProject(admin, A, { name: "동기화", idea_text: "", is_b2b: false })).id;
    await extractBusinessModel(admin, pc, A, { text: "가설 동기화 확인용 아이디어 설명" });
    const hs = (await raw.query<{ source_field: string; material_check: string; type: string }>(
      `select source_field, material_check, type from public.hypotheses where project_id = '${pc}' and source_field is not null`)).rows;
    expect(hs).toHaveLength(9);
    expect(hs.find((h) => h.source_field === "channels")!.material_check).toBe("missing");
    for (const h of hs) expect(methodsFor(h.type as never, false).length).toBeGreaterThan(0);
    // 다시 뽑아도 칸마다 하나
    await extractBusinessModel(admin, pc, A, { text: "같은 프로젝트 두 번째 추출" });
    expect((await raw.query(`select 1 from public.hypotheses where project_id = '${pc}' and source_field is not null`)).rows).toHaveLength(9);
  });

  it("진단 체크리스트도 세 단계(충분함=yes·부족함=unknown·없음=no)로 시작하고 근거와 부족한 점이 나뉜다", async () => {
    const pd = (await createProject(admin, A, { name: "진단 단계", idea_text: "", is_b2b: false })).id;
    await extractBusinessModel(admin, pd, A, { text: "진단 단계 확인용 아이디어" });
    await runDiag(admin, pd, A);
    const items = (await raw.query<{ status: string; evidence_note: string; gap: string }>(
      `select status, evidence_note, gap from public.wrapper_items where project_id = '${pd}'`)).rows;
    expect(new Set(items.map((i) => i.status))).toEqual(new Set(["yes", "unknown", "no"]));
    expect(items.every((i) => !i.evidence_note.includes("자료에 없음"))).toBe(true);
    expect(items.filter((i) => i.status !== "yes").every((i) => i.gap.length > 0)).toBe(true);
  });
});
