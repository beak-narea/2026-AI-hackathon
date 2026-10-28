// 3번 기능: 블라인드 기준선 테스트. 같은 입력을 범용 모델에 단순 프롬프트로 돌리고,
// 출처를 가리고 순서를 섞어 잠재 고객·외부 평가자가 고르게 한다.
import "server-only";
import { randomInt } from "node:crypto";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must, notFound } from "../api/handler";
import { llmFor } from "../llm/factory";
import { baselinePrompt } from "../llm/prompts";
import { serverEnv } from "../env";
import { BASELINE_MIN_SAMPLES, baselineVerdict } from "../domain/rules";
import { updateDiagnosis } from "./diagnosis";
import { pseudonymize } from "../pii/pseudonymize";
import { selectAll, selectIn } from "../supabase/paging";

const MAX_EVALUATORS = 100;

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

export interface BaselineStart {
  diagnosis_id?: string | null;
  instruction: string;
  samples: { input: string; ours: string }[];
}

export async function startBaseline(admin: Db, projectId: string, userId: string, input: BaselineStart) {
  if (input.samples.length < BASELINE_MIN_SAMPLES) {
    throw badRequest(`샘플은 ${BASELINE_MIN_SAMPLES}개 이상 필요하다`);
  }
  if (input.diagnosis_id) {
    must(await admin.from("diagnoses").select("id").eq("id", input.diagnosis_id).eq("project_id", projectId).maybeSingle(), "진단");
  }
  const env = serverEnv();
  const llm = llmFor(admin, projectId, userId, env.BASELINE_MODEL);
  // 범용 모델 결과를 먼저 모두 만든 뒤 저장한다 (중간에 실패하면 빈 테스트가 남지 않게, 6개씩 함께)
  const generics = await pool(input.samples, 6, (s) => llm.structured(baselinePrompt(input.instruction, s.input)));
  const test = must(
    await admin
      .from("baseline_tests")
      .insert({ project_id: projectId, diagnosis_id: input.diagnosis_id ?? null, prompt_used: input.instruction, model: env.BASELINE_MODEL })
      .select("*")
      .single(),
  );
  // 평가자에게 보이는 입력과 결과는 가명 처리한다
  let entries: ReturnType<typeof pseudonymize>["entries"] = [];
  const pairs = [];
  for (const [i, s] of input.samples.entries()) {
    const generic = generics[i]!;
    const aIsOurs = randomInt(2) === 0;
    const pIn = pseudonymize(s.input, { existing: entries });
    entries = pIn.entries;
    const pOurs = pseudonymize(s.ours, { existing: entries });
    entries = pOurs.entries;
    const pGen = pseudonymize(generic.output, { existing: entries });
    entries = pGen.entries;
    pairs.push({
      project_id: projectId,
      test_id: test.id,
      sample_index: i,
      input_text: pIn.text,
      output_a: aIsOurs ? pOurs.text : pGen.text,
      output_b: aIsOurs ? pGen.text : pOurs.text,
      a_is_ours: aIsOurs,
    });
  }
  const { error: pairError } = await admin.from("baseline_pairs").insert(pairs);
  if (pairError) {
    await admin.from("baseline_tests").delete().eq("id", test.id);
    throw pairError;
  }
  return { test, evaluator_url: `${env.APP_URL}/evaluate/${test.share_token}`, samples: pairs.length };
}

/** 평가자 화면용: 어느 쪽이 자사 결과인지는 절대 내보내지 않는다 */
export async function evaluatorView(admin: Db, token: string) {
  const test = must(await admin.from("baseline_tests").select("id, prompt_used").eq("share_token", token).maybeSingle(), "평가");
  const pairs = must(
    await admin.from("baseline_pairs").select("id, sample_index, input_text, output_a, output_b").eq("test_id", test.id),
  ) as Array<{ id: string; sample_index: number }>;
  // 샘플 순서도 섞는다
  const shuffled = [...pairs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return { instruction: test.prompt_used, pairs: shuffled.map(({ sample_index: _drop, ...p }) => p) };
}

export async function submitVotes(admin: Db, token: string, evaluator: string, votes: { pair_id: string; chose_a: boolean }[]) {
  const test = must(await admin.from("baseline_tests").select("id, project_id").eq("share_token", token).maybeSingle(), "평가");
  const pairIds = new Set(
    (await selectAll<{ id: string }>((f, t) => admin.from("baseline_pairs").select("id").eq("test_id", test.id).order("id").range(f, t))).map((p) => p.id),
  );
  if (votes.some((v) => !pairIds.has(v.pair_id))) throw badRequest("이 평가에 없는 항목이 있다");
  if (new Set(votes.map((v) => v.pair_id)).size !== votes.length) throw badRequest("같은 항목을 두 번 골랐다");
  // 평가자 한 명이 이름만 바꿔 여러 번 내는 것을 줄인다: 평가자 수 상한
  const pairList = [...pairIds];
  // 일부 항목만 고른 평가자도 세도록 모든 항목의 표를 본다
  const seen = await selectIn<{ evaluator: string }>(pairList, (chunk, f, t) =>
    admin.from("baseline_votes").select("evaluator").in("pair_id", chunk).order("id").range(f, t),
  );
  const evaluators = new Set(seen.map((v) => v.evaluator));
  if (!evaluators.has(evaluator) && evaluators.size >= MAX_EVALUATORS) throw conflict("이 평가는 평가자 수 상한에 도달했다");
  const { error } = await admin.from("baseline_votes").insert(
    votes.map((v) => ({ project_id: test.project_id, pair_id: v.pair_id, evaluator, chose_a: v.chose_a })),
  );
  if (error?.code === "23505") throw conflict("이미 평가를 제출했다");
  if (error) throw error;
  return { received: votes.length };
}

/** 판정 계산 (읽기만): 샘플당 다수결 1표, 동수면 범용 모델 쪽. 목표값 70%, 최소 허용치 50%. */
export async function computeBaseline(admin: Db, projectId: string, testId: string) {
  const test = must(
    await admin.from("baseline_tests").select("*").eq("id", testId).eq("project_id", projectId).maybeSingle(),
    "기준선 테스트",
  );
  const pairs = await selectAll<{ id: string; sample_index: number; a_is_ours: boolean }>((f, t) =>
    admin.from("baseline_pairs").select("id, sample_index, a_is_ours").eq("test_id", testId).order("sample_index").range(f, t),
  );
  const votes = await selectAll<{ pair_id: string; evaluator: string; chose_a: boolean }>((f, t) =>
    admin.from("baseline_votes").select("id, pair_id, evaluator, chose_a").in("pair_id", pairs.map((p) => p.id)).order("id").range(f, t),
  );
  if (!votes.length) throw notFound("평가 결과");
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const verdict = baselineVerdict(
    votes.map((v) => {
      const p = byId.get(v.pair_id)!;
      return { sampleIndex: p.sample_index, choseOurs: v.chose_a === p.a_is_ours };
    }),
  );
  const evaluators = new Set(votes.map((v) => v.evaluator)).size;
  return {
    test,
    result: {
      ...verdict,
      evaluators,
      samples_without_votes: pairs.length - verdict.samples,
      wrapper_warning: verdict.result === "not_met" ? "범용 모델과 구별되지 않는다: 래퍼 위험 경고" : null,
    },
  };
}

/** 판정을 진단에 반영 (편집자만, 같은 프로젝트의 진단에만) */
export async function applyBaseline(admin: Db, projectId: string, testId: string) {
  const { test, result } = await computeBaseline(admin, projectId, testId);
  if (test.diagnosis_id) {
    const updated = await admin
      .from("diagnoses")
      .update({ baseline_win_rate: result.oursWins / result.samples, baseline_result: result.result, feasibility_level: "L3" })
      .eq("id", test.diagnosis_id)
      .eq("project_id", projectId)
      .select("id");
    if (updated.data?.length) await updateDiagnosis(admin, projectId, test.diagnosis_id as string, {});
  }
  return { ...result, applied: !!test.diagnosis_id };
}

/** 이전 이름 호환 (읽기만) */
export async function baselineResult(admin: Db, projectId: string, testId: string) {
  return (await computeBaseline(admin, projectId, testId)).result;
}
