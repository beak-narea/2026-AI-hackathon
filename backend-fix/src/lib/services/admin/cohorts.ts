// 서비스 성공 기준 (기획 "성공 기준"): 결정 변화와 지불, 기수 누적 3갈래 판정.
// 목표값·최소 허용치는 처음 잠근 값이다. 기수가 늘어도 바꾸지 않는다. 재판정은 최대 4회.
import "server-only";
import type { Db } from "../../supabase/server";
import { must } from "../../api/handler";
import { conclusionProbability, judge, wilson, MAX_LOOKS } from "../../stats/verdict";
import { selectIn } from "../../supabase/paging";

export const SUCCESS_CRITERIA = {
  decision: { target: 0.4, min: 0.2, label: "결정 변화 (근거 있는 수정·중단)" },
  payment: { target: 0.25, min: 0.1, label: "지불 (같은 날 같은 가격 제안 후 2주 안 선결제)" },
} as const;

type Team = {
  id: string; cohort_id: string; project_id: string | null; team_name: string; is_design_partner: boolean;
  offered_at: string | null; prepaid: boolean | null; note: string;
};

const DAY = 86_400_000;

export async function cohortReport(admin: Db, now = new Date()) {
  const cohorts = must(await admin.from("cohorts").select("*").order("started_at")) as Array<{ id: string; name: string; started_at: string; note: string }>;
  const teams = must(await admin.from("cohort_teams").select("*").order("created_at")) as Team[];
  const projectIds = teams.map((t) => t.project_id).filter((x): x is string => !!x);
  const ids = [...new Set(projectIds)];
  const [dec, props, evid] = await Promise.all([
    selectIn<{ project_id: string }>(ids, (c, f, t) => admin.from("decisions").select("id, project_id").in("project_id", c).eq("is_grounded_change", true).order("id").range(f, t)),
    selectIn<{ project_id: string }>(ids, (c, f, t) => admin.from("proposals").select("id, project_id").in("project_id", c).not("locked_at", "is", null).order("id").range(f, t)),
    selectIn<{ project_id: string }>(ids, (c, f, t) => admin.from("evidence").select("id, project_id").in("project_id", c).order("id").range(f, t)),
  ]);
  const grounded = new Set(dec.map((d) => d.project_id));
  const gotProposal = new Set(props.map((p) => p.project_id));
  const submitted = new Set(evid.map((e) => e.project_id));

  const teamRow = (t: Team) => {
    const paymentDecided = t.offered_at ? t.prepaid !== null || now.getTime() > new Date(t.offered_at).getTime() + 14 * DAY : false;
    return {
      ...t,
      grounded_change: !!t.project_id && grounded.has(t.project_id),
      received_proposal: !!t.project_id && gotProposal.has(t.project_id),
      submitted_result: !!t.project_id && submitted.has(t.project_id),
      payment_counted: paymentDecided,
      paid: paymentDecided && t.prepaid === true,
    };
  };

  const rows = cohorts.map((c, i) => {
    const upto = new Set(cohorts.slice(0, i + 1).map((x) => x.id));
    const cum = teams.filter((t) => upto.has(t.cohort_id)).map(teamRow);
    const look = i + 1;
    const decisionN = cum.length;
    const decisionK = cum.filter((t) => t.grounded_change).length;
    const payTeams = cum.filter((t) => t.payment_counted);
    const payK = payTeams.filter((t) => t.paid).length;
    const evaluate = (k: number, n: number, crit: { target: number; min: number }) => {
      if (n === 0) return null;
      if (look > MAX_LOOKS) return { result: "no_conclusion" as const, k, n, note: "재판정 상한(4회)을 넘었다" };
      const v = judge({ successes: k, n, target: crit.target, min: crit.min, look });
      const [lo, hi] = wilson(k, n);
      return { result: v.result, k, n, p_above_target: v.pAboveTarget, p_below_min: v.pBelowMin, wilson_low: lo, wilson_high: hi, look };
    };
    const received = cum.filter((t) => t.received_proposal);
    return {
      cohort: c,
      teams: teams.filter((t) => t.cohort_id === c.id).map(teamRow),
      cumulative_teams: cum.length,
      decision: evaluate(decisionK, decisionN, SUCCESS_CRITERIA.decision),
      payment: evaluate(payK, payTeams.length, SUCCESS_CRITERIA.payment),
      payment_not_counted: cum.length - payTeams.length,
      // 보조 지표: 기획서를 받아 간 팀 중 결과를 낸 비율 (성공 기준 아님)
      submission: { k: received.filter((t) => t.submitted_result).length, n: received.length },
    };
  });
  // 지금 팀 수로 결론이 날 확률 (보고에 함께 적는다)
  const latest = rows.at(-1);
  const outlook = latest
    ? {
        decision_at_50pct: latest.cumulative_teams ? conclusionProbability(latest.cumulative_teams, SUCCESS_CRITERIA.decision, 0.5) : null,
        payment_at_25pct: latest.cumulative_teams ? conclusionProbability(latest.cumulative_teams, SUCCESS_CRITERIA.payment, 0.25) : null,
      }
    : null;
  const { data: projects } = await admin.from("projects").select("id, name").eq("is_example", false).order("created_at", { ascending: false }).limit(500);
  return { criteria: SUCCESS_CRITERIA, cohorts: rows, outlook, projects: projects ?? [] };
}

export async function createCohort(admin: Db, input: { name: string; started_at?: string; note?: string }) {
  return must(await admin.from("cohorts").insert(input).select("*").single());
}

export async function upsertTeam(
  admin: Db,
  input: { id?: string; cohort_id: string; team_name: string; project_id?: string | null; is_design_partner?: boolean; offered_at?: string | null; prepaid?: boolean | null; note?: string },
) {
  const { id, ...row } = input;
  if (id) return must(await admin.from("cohort_teams").update(row).eq("id", id).select("*").single());
  return must(await admin.from("cohort_teams").insert(row).select("*").single());
}

export async function deleteTeam(admin: Db, id: string) {
  must(await admin.from("cohort_teams").delete().eq("id", id).select("id"));
  return { removed: id };
}

/** 같은 날짜·같은 조건 제안: 기수의 모든 팀에 offered_at을 한 번에 기록 */
export async function offerAll(admin: Db, cohortId: string, date: string) {
  must(await admin.from("cohort_teams").update({ offered_at: date }).eq("cohort_id", cohortId).select("id"));
  return { ok: true };
}
