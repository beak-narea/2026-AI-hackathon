// 코드 검토에서 나온 문제들이 다시 생기지 않는지 (회귀 테스트)
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "../db/migrate";
import { fakeSupabase } from "@/lib/dev/fakeSupabase";
import type { Db } from "@/lib/supabase/server";
import { createProject } from "@/lib/services/projects";
import { extractBusinessModel, saveVersion } from "@/lib/services/businessModel";
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

describe("블라인드 평정", () => {
  it("아직 매기지 않은 평가자에게는 다른 사람의 평정과 합의 값을 보내지 않는다", async () => {
    await raw.exec(`insert into public.project_members (project_id, user_id, email, role) values ('${pa}', '${RATER}', 'r@x.com', 'external_rater')`);
    const h = await createHypothesis(admin, pa, { statement: "블라인드 확인용 가설", type: "data" });
    await rateCriticality(admin, pa, h.id, { userId: A, name: "A", type: "team" }, "critical", "비밀 메모");
    const forRater = (await listHypotheses(admin, pa, { userId: RATER, canRate: true })).find((x) => x.id === h.id)!;
    expect(forRater.ratings).toHaveLength(0);
    expect(forRater.ratings_hidden).toBe(1);
    expect(JSON.stringify(forRater)).not.toContain("비밀 메모");
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

  it("보관 기간 정리는 200개씩 끝까지 지운다", async () => {
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
