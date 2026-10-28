// 척도와 설계 가정 점검 (기획 "LLM 판단의 신뢰도 척도 (1)", "검증되지 않은 설계 가정")
// 프로젝트별이 아니라 서비스 전체에 쌓인 기록으로 주기적으로 본다. 예시 프로젝트는 뺀다.
import "server-only";
import type { Db } from "../../supabase/server";
import { krippendorffAlpha, requiredUnits } from "../../reliability/agreement";
import { wilson } from "../../stats/verdict";

const DAY = 86_400_000;
const rate = (k: number, n: number) => ({ k, n, rate: n ? k / n : null, ci: n ? wilson(k, n) : null });

async function realProjectIds(admin: Db): Promise<string[]> {
  const { data } = await admin.from("projects").select("id").eq("is_example", false);
  return ((data ?? []) as Array<{ id: string }>).map((p) => p.id);
}

/** 가설마다 최신 판정 (충족·미달만 결과로 본다) */
async function finalOutcomes(admin: Db, ids: string[]) {
  if (!ids.length) return new Map<string, "met" | "not_met">();
  const { data } = await admin.from("verdicts").select("hypothesis_id, result, created_at").in("project_id", ids).order("created_at", { ascending: false });
  const out = new Map<string, "met" | "not_met">();
  const seen = new Set<string>();
  for (const v of (data ?? []) as Array<{ hypothesis_id: string; result: string }>) {
    if (seen.has(v.hypothesis_id)) continue;
    seen.add(v.hypothesis_id);
    if (v.result === "met" || v.result === "not_met") out.set(v.hypothesis_id, v.result);
  }
  return out;
}

export async function qualityReport(admin: Db) {
  const ids = await realProjectIds(admin);
  const none = <T,>(x: T[]) => x;
  const [ratingsR, hypsR, evidR, propsR, diagsR, projR, eventsR] = ids.length
    ? await Promise.all([
        admin.from("criticality_ratings").select("hypothesis_id, rater_user_id, rater_type, level, needs_review").in("project_id", ids),
        admin.from("hypotheses").select("id, project_id, criticality, diagnosis_id").in("project_id", ids),
        admin.from("evidence").select("project_id, proposal_id, method_same, notice_given, created_at").in("project_id", ids),
        admin.from("proposals").select("id, project_id, locked_at, method_key").in("project_id", ids),
        admin.from("diagnoses").select("id, wrapper_risk").in("project_id", ids),
        admin.from("projects").select("id, owner_id, created_at").in("id", ids),
        admin.from("events").select("user_id, name").eq("name", "example_viewed"),
      ])
    : Array.from({ length: 7 }, () => ({ data: none([]) }));
  const ratings = (ratingsR.data ?? []) as Array<{ hypothesis_id: string; rater_user_id: string | null; rater_type: string; level: string; needs_review: boolean }>;
  const hyps = (hypsR.data ?? []) as Array<{ id: string; project_id: string; criticality: string | null; diagnosis_id: string | null }>;
  const evidence = (evidR.data ?? []) as Array<{ project_id: string; proposal_id: string; method_same: boolean; notice_given: boolean | null; created_at: string }>;
  const proposals = (propsR.data ?? []) as Array<{ id: string; project_id: string; locked_at: string | null }>;
  const diags = (diagsR.data ?? []) as Array<{ id: string; wrapper_risk: string | null }>;
  const projects = (projR.data ?? []) as Array<{ id: string; owner_id: string | null; created_at: string }>;
  const viewers = new Set(((eventsR.data ?? []) as Array<{ user_id: string | null }>).map((e) => e.user_id).filter(Boolean));
  const outcome = await finalOutcomes(admin, ids);

  // (1) 중요도 척도 α: 사람 평정자(팀·외부)만, 같은 가정을 2명 이상이 매긴 것만
  const human = ratings.filter((r) => r.rater_type !== "llm" && r.rater_user_id);
  const raters = [...new Set(human.map((r) => r.rater_user_id!))];
  const units = [...new Set(human.map((r) => r.hypothesis_id))].filter((h) => human.filter((r) => r.hypothesis_id === h).length >= 2);
  const matrix = raters.map((rid) => units.map((u) => human.find((r) => r.rater_user_id === rid && r.hypothesis_id === u)?.level ?? null));
  const alpha = units.length ? krippendorffAlpha(matrix, "ordinal", ["critical", "major", "minor"]) : null;
  const required = requiredUnits(3);

  // (2) 예측 타당도: 매긴 중요도별 실제 미달률
  const byLevel = (lvl: string) => {
    const hs = hyps.filter((h) => h.criticality === lvl && outcome.has(h.id));
    return rate(hs.filter((h) => outcome.get(h.id) === "not_met").length, hs.length);
  };

  // (3) LLM 반대 평가자 "재검토" 표시 항목의 미달률 vs 나머지
  const flagged = new Set(ratings.filter((r) => r.rater_type === "llm" && r.needs_review).map((r) => r.hypothesis_id));
  const judged = hyps.filter((h) => outcome.has(h.id));
  const notMet = (list: typeof judged) => rate(list.filter((h) => outcome.get(h.id) === "not_met").length, list.length);

  // (4) 대체 위험 등급별 이후 미달률
  const riskOf = new Map(diags.map((d) => [d.id, d.wrapper_risk]));
  const byRisk = (lvl: string) => notMet(judged.filter((h) => h.diagnosis_id && riskOf.get(h.diagnosis_id) === lvl));

  // (5) 실행 충실도: 제안과 같은 방법 비율, 운영 수칙(고지) 준수율
  const notice = evidence.filter((e) => e.notice_given !== null);

  // (6) 예시 프로젝트: 본 사람과 안 본 사람의 첫 검증 제안 채택률 (첫 프로젝트에 잠근 제안이 있는가)
  const firstProject = new Map<string, { id: string; created_at: string }>();
  for (const p of [...projects].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (p.owner_id && !firstProject.has(p.owner_id)) firstProject.set(p.owner_id, p);
  }
  const adopted = (owner: string) => proposals.some((pr) => pr.project_id === firstProject.get(owner)!.id && pr.locked_at);
  const owners = [...firstProject.keys()];
  const saw = owners.filter((o) => viewers.has(o));
  const didnt = owners.filter((o) => !viewers.has(o));

  // (7) 8주 안 검증 사이클 수: 첫 제안을 잠근 뒤 8주 안에 낸 결과 수
  const cycles = ids
    .map((pid) => {
      const first = proposals.filter((p) => p.project_id === pid && p.locked_at).map((p) => p.locked_at!).sort()[0];
      if (!first) return null;
      const end = new Date(first).getTime() + 56 * DAY;
      const matured = Date.now() >= end;
      const n = evidence.filter((e) => e.project_id === pid && new Date(e.created_at).getTime() <= end).length;
      return { project_id: pid, results_in_8_weeks: n, matured };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const matured = cycles.filter((c) => c.matured);

  // 보조 지표: 기획서를 받아 간 팀(잠근 제안이 있는 프로젝트) 중 결과를 낸 비율
  const withLocked = new Set(proposals.filter((p) => p.locked_at).map((p) => p.project_id));
  const withEvidence = new Set(evidence.map((e) => e.project_id));

  return {
    projects: ids.length,
    criticality_scale: {
      alpha,
      units: units.length,
      raters: raters.length,
      required_units: required,
      status: alpha === null || units.length < required ? "표본 부족" : alpha >= 0.8 ? "통과" : alpha >= 0.667 ? "주의" : "앵커 정의를 고친다",
    },
    predictive_validity: { critical: byLevel("critical"), major: byLevel("major"), minor: byLevel("minor") },
    llm_devils_advocate: { flagged: notMet(judged.filter((h) => flagged.has(h.id))), others: notMet(judged.filter((h) => !flagged.has(h.id))) },
    wrapper_grade: { high: byRisk("high"), mid: byRisk("mid"), low: byRisk("low") },
    execution_fidelity: {
      method_same: rate(evidence.filter((e) => e.method_same).length, evidence.length),
      notice_compliance: rate(notice.filter((e) => e.notice_given).length, notice.length),
    },
    example_effect: {
      viewed: rate(saw.filter(adopted).length, saw.length),
      not_viewed: rate(didnt.filter(adopted).length, didnt.length),
    },
    cycles_in_8_weeks: {
      projects: matured.length,
      mean: matured.length ? matured.reduce((s, c) => s + c.results_in_8_weeks, 0) / matured.length : null,
      at_least_3: rate(matured.filter((c) => c.results_in_8_weeks >= 3).length, matured.length),
      in_progress: cycles.length - matured.length,
    },
    submission_rate: rate([...withLocked].filter((p) => withEvidence.has(p)).length, withLocked.size),
  };
}

export async function workbankStatus(admin: Db) {
  const [all, embedded] = await Promise.all([
    admin.from("workbank_tasks").select("id", { count: "exact", head: true }),
    admin.from("workbank_tasks").select("id", { count: "exact", head: true }).not("embedding", "is", null),
  ]);
  return { tasks: all.count ?? 0, embedded: embedded.count ?? 0 };
}

/** 설계 가정 추적용 이벤트 (사람마다 한 번) */
export async function trackOnce(admin: Db, userId: string, name: string, projectId: string | null = null) {
  const { count } = await admin.from("events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("name", name);
  if ((count ?? 0) > 0) return;
  await admin.from("events").insert({ user_id: userId, project_id: projectId, name });
}
