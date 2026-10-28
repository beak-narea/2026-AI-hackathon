// 결과 수령과 판정. 결과는 정해진 폼으로만 받고, 폼이 없으면 판정하지 않는다.
import "server-only";
import { z } from "zod";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must } from "../api/handler";
import { canJudge, levelAtLeast, EVIDENCE_LEVELS, type EvidenceLevel, type HypothesisType } from "../domain/rules";
import { methodByKey, PILOT_CONDITIONS } from "../domain/experiments";
import { effectiveSample } from "../stats/cluster";
import { judge } from "../stats/verdict";
import { pseudonymize, type PseudonymEntry, type PseudonymizeResult } from "../pii/pseudonymize";
import { selectAll } from "../supabase/paging";
import { extensionOf, storageFileName } from "../storage/key";
import { llmFor } from "../llm/factory";
import { transcriptPrompt } from "../llm/prompts";
import { verifyQuotes } from "../llm/quotes";
import { interviewQuality } from "../domain/rules";
import { applyAxisVerdict } from "./diagnosis";
import { notifyProject } from "./notifications";
import { codeGates } from "./coding";

/** 결과 제출 폼 (Figma: input:evidence.*) */
export const EvidenceForm = z
  .object({
    method_same: z.boolean(),
    method_diff_reason: z.string().min(2).optional(),
    /** 다른 방법을 썼다면 실제 방법 (실험 목록 키) 또는 진술 방법 */
    actual_method_key: z.string().optional(),
    actual_kind: z.enum(["survey", "interview", "other"]).optional(),
    recruitment: z.string().min(2),
    attempts: z.number().int().nonnegative(),
    responses: z.number().int().nonnegative(),
    successes: z.number().int().nonnegative(),
    clusters: z.number().int().positive().optional(),
    cluster_successes: z.number().int().nonnegative().optional(),
    icc: z.number().min(0).max(1).optional(),
    raw_files: z.array(z.object({ path: z.string(), name: z.string(), kind: z.string() })).default([]),
    acquaintance_ratio: z.number().min(0).max(1),
    same_company_count: z.number().int().nonnegative(),
    notice_given: z.boolean().nullable().default(null),
    pilot_conditions: z.partialRecord(z.enum(PILOT_CONDITIONS), z.boolean()).optional(),
    memo: z.string().default(""),
  })
  .refine((f) => f.successes <= f.responses && f.responses <= f.attempts, {
    message: "성공 수 ≤ 응답 수 ≤ 시도 수여야 한다",
  })
  .refine((f) => f.method_same || !!f.method_diff_reason, { message: "제안과 다른 방법을 썼다면 이유를 적는다" })
  .refine((f) => f.clusters === undefined || f.clusters <= f.responses, { message: "묶음 수는 응답 수보다 클 수 없다" })
  .refine((f) => f.cluster_successes === undefined || (f.clusters !== undefined && f.cluster_successes <= f.clusters), {
    message: "성공한 묶음 수는 묶음 수를 넘을 수 없고, 묶음 수와 함께 적는다",
  });
export type EvidenceForm = z.infer<typeof EvidenceForm>;

const ACQUAINTANCE_LIMIT = 0.3;

function decideLevel(expected: EvidenceLevel, form: EvidenceForm): EvidenceLevel {
  if (form.method_same) return expected;
  if (form.actual_method_key) {
    const m = methodByKey(form.actual_method_key);
    if (!m) throw badRequest("알 수 없는 실험 방법이다");
    return m.evidenceLevel;
  }
  // 설문·인터뷰 등 진술 방법
  return "L1";
}

function minLevel(levels: EvidenceLevel[]): EvidenceLevel {
  return levels.reduce((a, b) => (EVIDENCE_LEVELS.indexOf(a) <= EVIDENCE_LEVELS.indexOf(b) ? a : b));
}

export async function submitEvidence(admin: Db, projectId: string, proposalId: string, userId: string, form: EvidenceForm) {
  const p = must(await admin.from("proposals").select("*").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  if (!p.locked_at) throw conflict("목표값·최소 허용치를 잠근 뒤에 결과를 낼 수 있다");
  for (const f of form.raw_files) {
    if (!f.path.startsWith(`${projectId}/`)) throw badRequest("이 프로젝트에 올린 원자료만 붙일 수 있다");
  }
  const { count } = await admin.from("evidence").select("id", { count: "exact", head: true }).eq("proposal_id", proposalId);
  if ((count ?? 0) > 0) throw conflict("이 제안의 결과는 이미 제출됐다. 표본을 늘리려면 재판정 제안을 만든다.");
  const h = must(await admin.from("hypotheses").select("id, type, evidence_level, status").eq("id", p.hypothesis_id).maybeSingle(), "가설");

  const level = decideLevel(p.evidence_level_expected as EvidenceLevel, form);
  const eff = effectiveSample({
    n: form.responses,
    successes: form.successes,
    clusters: form.clusters ?? null,
    clusterSuccesses: form.cluster_successes ?? null,
    icc: form.icc ?? null,
  });

  // 저장하기 전에 판정이 계산되는지 확인한다 (저장만 되고 판정이 안 나 제안이 막히는 일이 없게)
  if (eff.n < 0 || eff.successes < 0 || eff.successes > eff.n) throw badRequest("유효 표본 계산이 맞지 않는다: 묶음 수와 성공한 묶음 수를 확인한다");

  const flags: string[] = [];
  if (form.raw_files.length === 0) flags.push("원자료 없음");
  if (form.acquaintance_ratio > ACQUAINTANCE_LIMIT) flags.push(`지인·기존 고객 비율 ${Math.round(form.acquaintance_ratio * 100)}%`);
  if (form.same_company_count > 1 && !form.clusters) flags.push("같은 회사 응답자가 있으나 묶음 정보가 없다 (군집 보정 불가)");
  if (!form.method_same) flags.push("제안과 다른 방법");
  if (p.sample_size && form.responses < p.sample_size) flags.push(`계획 표본(${p.sample_size})보다 적다`);
  const method = methodByKey(p.method_key);
  if (method?.operatingRules.length && form.notice_given === false) flags.push("운영 수칙(고지) 미준수");
  if (eff.warning) flags.push(eff.warning);
  if (p.method_key === "paid_pilot") {
    const met = PILOT_CONDITIONS.filter((c) => form.pilot_conditions?.[c]).length;
    if (met < 4) flags.push(`유료 파일럿 조건 ${met}/${PILOT_CONDITIONS.length}개: 데모에 가깝다`);
  }

  const inserted = await admin
      .from("evidence")
      .insert({
        project_id: projectId,
        proposal_id: proposalId,
        submitted_by: userId,
        method_same: form.method_same,
        method_diff_reason: form.method_diff_reason ?? null,
        recruitment: form.recruitment,
        attempts: form.attempts,
        responses: form.responses,
        successes: form.successes,
        clusters: form.clusters ?? null,
        cluster_successes: form.cluster_successes ?? null,
        raw_files: form.raw_files,
        has_raw: form.raw_files.length > 0,
        acquaintance_ratio: form.acquaintance_ratio,
        same_company_count: form.same_company_count,
        notice_given: form.notice_given,
        pilot_conditions: form.pilot_conditions ?? null,
        memo: form.memo,
        evidence_level: level,
        effective_n: eff.n,
        effective_successes: eff.successes,
        cluster_method: eff.method,
        quality_flags: flags,
      })
      .select("*")
      .single();
  if (inserted.error?.code === "23505") throw conflict("이 제안의 결과는 이미 제출됐다. 표본을 늘리려면 재판정 제안을 만든다.");
  const evidence = must(inserted);

  let verdict: Awaited<ReturnType<typeof judgeChain>>;
  try {
    verdict = await judgeChain(admin, projectId, proposalId, h.type as HypothesisType);
  } catch (e) {
    // 판정에 실패하면 증거를 되돌려 다시 낼 수 있게 한다
    await admin.from("evidence").delete().eq("id", evidence.id);
    throw e;
  }
  // 판정까지 저장된 뒤의 상태 갱신: 실패해도 증거·판정은 되돌리지 않는다 (판정이 증거를 가리킨다)
  const statusRes = await admin.from("proposals").update({ status: "received" }).eq("id", proposalId).eq("project_id", projectId);
  if (statusRes.error) console.error("[evidence] 제안 상태 갱신 실패", statusRes.error.message);
  // 가설의 증거 수준은 받은 증거 중 가장 높은 수준
  if (!levelAtLeast(h.evidence_level as EvidenceLevel, level)) {
    const levelRes = await admin.from("hypotheses").update({ evidence_level: level }).eq("id", h.id).eq("project_id", projectId);
    if (levelRes.error) console.error("[evidence] 가설 증거 수준 갱신 실패", levelRes.error.message);
  }
  return { evidence, verdict };
}

/** 재판정 사슬 전체의 증거를 합쳐 판정한다. 판정 가능한 수준의 증거만 쓴다. */
export async function judgeChain(admin: Db, projectId: string, proposalId: string, type: HypothesisType) {
  const p = must(await admin.from("proposals").select("*").eq("id", proposalId).maybeSingle(), "검증 제안");
  const rootId = p.root_proposal_id ?? p.id;
  const chain = must(
    await admin.from("proposals").select("id, look_number").or(`id.eq.${rootId},root_proposal_id.eq.${rootId}`),
  ) as Array<{ id: string; look_number: number }>;
  const evidence = must(
    await admin.from("evidence").select("*").in("proposal_id", chain.map((c) => c.id)),
  ) as Array<{ id: string; evidence_level: EvidenceLevel; effective_n: number; effective_successes: number; responses: number }>;

  const usable = evidence.filter((e) => canJudge(type, e.evidence_level).ok);
  if (!usable.length) {
    const reason = canJudge(type, evidence[0]?.evidence_level ?? "L0").reason;
    return { judged: false as const, reason };
  }
  const n = usable.reduce((s, e) => s + Number(e.effective_n), 0);
  const k = usable.reduce((s, e) => s + Number(e.effective_successes), 0);
  // 판정 회차 = 이번 결과가 속한 제안의 회차 (사슬의 증거는 누적)
  const look = p.look_number as number;
  const v = judge({ successes: k, n, target: Number(p.target_value), min: Number(p.min_value), look });
  const level = minLevel(usable.map((e) => e.evidence_level));
  const row = must(
    await admin
      .from("verdicts")
      .insert({
        project_id: projectId,
        hypothesis_id: p.hypothesis_id,
        proposal_id: proposalId,
        root_proposal_id: rootId,
        evidence_ids: usable.map((e) => e.id),
        look_number: look,
        n,
        successes: k,
        raw_n: usable.reduce((s, e) => s + e.responses, 0),
        target_value: p.target_value,
        min_value: p.min_value,
        p_above_target: v.pAboveTarget,
        p_below_min: v.pBelowMin,
        wilson_low: v.wilsonLow,
        wilson_high: v.wilsonHigh,
        result: v.result,
        evidence_level: level,
      })
      .select("*")
      .single(),
  );
  // 진단에 연결된 가설이면 4구역을 다시 계산한다
  const zone = await applyAxisVerdict(admin, projectId, p.hypothesis_id as string, { result: v.result, evidence_level: level }).catch((e) => {
    console.error("[zone]", (e as Error).message);
    return null;
  });
  // 미달 판정은 팀에 알린다
  if (v.result === "not_met") {
    // 알림 실패가 판정 저장을 되돌리지 않게
    await notifyProject(admin, projectId, {
      kind: "verdict_not_met",
      title: "미달 판정이 나왔습니다",
      body: `${k}/${n} — 최소 허용치에 못 미칠 확률이 판정 기준 이상입니다. 의사결정을 기록하세요.`,
      link: `/projects/${projectId}/decisions?hypothesis=${p.hypothesis_id}`,
      dedupeKey: `verdict:${row.id}`,
    }).catch((e) => console.error("[notify]", (e as Error).message));
  }
  return { judged: true as const, verdict: row, can_rejudge: v.canRejudge, zone: zone?.diagnosis.zone ?? undefined };
}

// ── 원자료 업로드: 가명 처리 후 저장 (원본은 저장하지 않는다) ─────────────
const TEXT_TYPES = ["text/plain", "text/csv", "application/json", "text/markdown"];

async function projectEntries(admin: Db, projectId: string): Promise<PseudonymEntry[]> {
  // 1000개가 넘어도 전부 읽어야 새 토큰 번호가 겹치지 않는다
  return selectAll<PseudonymEntry>((from, to) =>
    admin.from("pseudonym_keys").select("token, original, kind").eq("project_id", projectId).order("created_at").order("id").range(from, to),
  );
}

/** 프로젝트의 가명 키로 가명 처리하고 새 키를 저장한다. 동시에 다른 요청이 같은 토큰을 먼저 쓰면 다시 읽고 다시 매긴다. */
async function pseudonymizeForProject(
  admin: Db,
  projectId: string,
  text: string,
  hints: { names?: string[]; companies?: string[] },
): Promise<PseudonymizeResult> {
  for (let attempt = 0; ; attempt++) {
    const result = pseudonymize(text, { existing: await projectEntries(admin, projectId), knownNames: hints.names, knownCompanies: hints.companies });
    if (!result.added.length) return result;
    const { error } = await admin
      .from("pseudonym_keys")
      .insert(result.added.map((e) => ({ project_id: projectId, token: e.token, original: e.original, kind: e.kind })));
    if (!error) return result;
    if (error.code !== "23505" || attempt >= 4) {
      const err = new Error(error.message) as Error & { code?: string };
      err.code = error.code;
      throw err;
    }
  }
}

export async function uploadRawFile(
  admin: Db,
  projectId: string,
  proposalId: string,
  file: File,
  hints: { names?: string[]; companies?: string[] },
  userId: string | null = null,
) {
  must(await admin.from("proposals").select("id").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  const isText = TEXT_TYPES.includes(file.type) || /\.(csv|txt|md|json|tsv)$/i.test(file.name);
  if (!isText) throw badRequest("원자료는 CSV·텍스트·JSON만 받는다 (가명 처리를 위해). 사진·녹음은 전사본으로 바꿔 올린다.");
  if (file.size > 10 * 1024 * 1024) throw badRequest("파일은 10MB 이하");
  const original = await file.text();
  const result = await pseudonymizeForProject(admin, projectId, original, hints);
  const path = `${projectId}/${proposalId}/${storageFileName(file.name, "txt")}`;
  const { error } = await admin.storage
    .from("raw-files")
    .upload(path, new Blob([result.text], { type: file.type || "text/plain" }), { upsert: false });
  if (error) throw error;
  const kind = extensionOf(file.name, "txt");
  const { error: rowError } = await admin.from("raw_files").insert({
    project_id: projectId,
    proposal_id: proposalId,
    path,
    name: file.name,
    kind,
    size_bytes: new Blob([result.text]).size,
    pseudonymized: result.counts,
    uploaded_by: userId,
  });
  if (rowError) {
    // 목록에 없는 파일은 보관 기간 정리·계정 삭제에서 빠지므로 저장소에서도 지운다
    await admin.storage.from("raw-files").remove([path]);
    throw rowError;
  }
  return { path, name: file.name, kind, pseudonymized: result.counts };
}

/** 전사본 분석: 가명 처리 → LLM 인사이트 → 인용 문자열 대조 → 질문 품질 */
export async function analyzeTranscript(
  admin: Db,
  projectId: string,
  userId: string,
  input: { evidence_id?: string | null; text: string; names?: string[]; companies?: string[] },
) {
  if (input.evidence_id) {
    must(await admin.from("evidence").select("id").eq("id", input.evidence_id).eq("project_id", projectId).maybeSingle(), "증거");
  }
  const p = await pseudonymizeForProject(admin, projectId, input.text, { names: input.names, companies: input.companies });
  const llm = llmFor(admin, projectId, userId);
  const out = await llm.structured(transcriptPrompt(p.text));
  const verified = verifyQuotes(p.text, out.insights);
  const quality = interviewQuality(out.questions.map((q) => q.kind));
  // 코딩 일치도 기준을 넘은 코드 유형만 자동 적용, 해석형 코드는 항상 사람이 확정
  const gates = await codeGates(admin);
  const transcript = must(
    await admin
      .from("transcripts")
      .insert({
        project_id: projectId,
        evidence_id: input.evidence_id ?? null,
        pseudonymized_text: p.text,
        leading_ratio: quality.leadingRatio,
        future_ratio: quality.futureRatio,
        past_ratio: quality.pastRatio,
        low_trust: quality.lowTrust,
        quality_validated: gates.questionsValidated,
      })
      .select("*")
      .single(),
  );
  const insights = verified.kept.length
    ? must(
        await admin
          .from("insights")
          .insert(
            verified.kept.map((i) => ({
              project_id: projectId,
              transcript_id: transcript.id,
              text: i.text,
              code_type: i.code_type,
              is_interpretive: i.is_interpretive,
              quotes: i.quotes,
              needs_review: i.is_interpretive || gates.status[i.code_type] !== "auto",
            })),
          )
          .select("*"),
      )
    : [];
  return {
    transcript,
    insights,
    dropped_quotes: verified.droppedQuotes,
    dropped_insights: verified.droppedInsights,
    quality: { ...quality, validated: gates.questionsValidated },
    note: "전사본은 진술 증거(L1)다. 판정이 아니라 다음 검증 제안의 재료로만 쓴다.",
  };
}
