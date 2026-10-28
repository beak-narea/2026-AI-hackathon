// 증거-계획 불일치 경고와 점검 주기 관리 (기획 4.5.1, 4.5.4)
// 경고는 판정이 아니다. "지금 계획이 쌓인 증거와 맞지 않는 곳"을 알려 고객 팀이 점검하게 한다.
import "server-only";
import type { Db } from "../supabase/server";
import { must } from "../api/handler";

export type WarningKind =
  | "bm_changed_after_verification"
  | "critical_unverified_but_continuing"
  | "critical_without_proposal"
  | "critical_without_external_rater"
  | "proposal_overdue"
  | "decision_pending"
  | "decision_against_evidence"
  | "demand_split"
  | "needs_recheck";

export interface Warning {
  kind: WarningKind;
  severity: "high" | "mid";
  message: string;
  /** 화면 이동용 (가설·제안 id) */
  target?: string;
  /** proposal = target이 제안 id, proposals = target이 가설 id */
  screen: "hypotheses" | "proposals" | "proposal" | "decisions" | "business_model" | "diagnosis";
}

const DAY = 86_400_000;

export async function projectWarnings(admin: Db, projectId: string, now = new Date()): Promise<Warning[]> {
  const [hypsR, propsR, verdR, decR, bmR, diagR, ratingsR, evR] = await Promise.all([
    admin.from("hypotheses").select("id, statement, criticality, critical_candidate, status, created_at").eq("project_id", projectId),
    admin.from("proposals").select("id, hypothesis_id, method, status, locked_at, expected_weeks, created_at").eq("project_id", projectId),
    admin.from("verdicts").select("id, hypothesis_id, result, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
    admin.from("decisions").select("id, hypothesis_id, verdict_id, choice, decided_at").eq("project_id", projectId).order("decided_at", { ascending: false }),
    admin.from("business_models").select("version, created_at").eq("project_id", projectId).order("version", { ascending: false }).limit(1),
    admin.from("diagnoses").select("id, demand_verdict, buyer_demand_verdict, tasks(name)").eq("project_id", projectId),
    admin.from("criticality_ratings").select("hypothesis_id, rater_type").eq("project_id", projectId),
    admin.from("evidence").select("proposal_id").eq("project_id", projectId),
  ]);
  for (const r of [hypsR, propsR, verdR, decR, bmR, diagR, ratingsR, evR]) {
    if (r.error) throw new Error(`경고 계산 실패: ${r.error.message}`);
  }
  type H = { id: string; statement: string; criticality: string | null; critical_candidate: boolean; status: string; created_at: string };
  const hyps = (hypsR.data ?? []) as H[];
  const props = (propsR.data ?? []) as Array<{ id: string; hypothesis_id: string; method: string; status: string; locked_at: string | null; expected_weeks: number | null; created_at: string }>;
  const verdicts = (verdR.data ?? []) as Array<{ id: string; hypothesis_id: string; result: string; created_at: string }>;
  const decisions = (decR.data ?? []) as Array<{ id: string; hypothesis_id: string; verdict_id: string | null; choice: string; decided_at: string }>;
  const bm = (bmR.data ?? [])[0] as { version: number; created_at: string } | undefined;
  const diags = (diagR.data ?? []) as unknown as Array<{ id: string; demand_verdict: string | null; buyer_demand_verdict: string | null; tasks: { name: string } | null }>;
  const ratings = (ratingsR.data ?? []) as Array<{ hypothesis_id: string; rater_type: string }>;
  const submitted = new Set(((evR.data ?? []) as Array<{ proposal_id: string }>).map((e) => e.proposal_id));
  const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
  const out: Warning[] = [];

  // 1. 사업 모델이 바뀌었는데, 그 전 버전으로 받은 판정을 그대로 쓰고 있다
  if (bm && bm.version > 1) {
    const stale = new Set(verdicts.filter((v) => v.created_at < bm.created_at).map((v) => v.hypothesis_id));
    const live = hyps.filter((h) => stale.has(h.id) && ["met", "in_progress", "on_hold"].includes(h.status));
    if (live.length) {
      out.push({
        kind: "bm_changed_after_verification",
        severity: "mid",
        screen: "hypotheses",
        message: `사업 모델 ${bm.version}번 버전 전에 받은 판정을 쓰는 가설이 ${live.length}개 있다. 바뀐 모델에서도 같은 가설이 유효한지 확인한다.`,
      });
    }
  }

  // 2. 치명 가설이 충족되지 않았는데 계속(출시) 쪽으로 가고 있다
  const continuing = decisions.some((d) => d.choice === "continue");
  const openCritical = hyps.filter((h) => h.criticality === "critical" && h.status !== "met");
  if (continuing && openCritical.length) {
    out.push({
      kind: "critical_unverified_but_continuing",
      severity: "high",
      screen: "hypotheses",
      message: `'계속'을 결정했지만 충족되지 않은 치명 가설이 ${openCritical.length}개 남아 있다.`,
    });
  }

  // 3. 치명 가설인데 검증 제안이 없다
  for (const h of hyps.filter((x) => x.criticality === "critical" && x.status === "unverified")) {
    if (!props.some((p) => p.hypothesis_id === h.id)) {
      out.push({ kind: "critical_without_proposal", severity: "high", screen: "proposals", target: h.id, message: `치명 가설 "${short(h.statement)}"에 검증 제안이 없다.` });
    }
  }

  // 4. 치명 후보인데 팀 밖 평가자가 매기지 않았다
  for (const h of hyps.filter((x) => (x.critical_candidate || x.criticality === "critical") && x.status === "unverified")) {
    if (!ratings.some((r) => r.hypothesis_id === h.id && r.rater_type === "external")) {
      out.push({ kind: "critical_without_external_rater", severity: "mid", screen: "hypotheses", target: h.id, message: `치명 후보 "${short(h.statement)}"를 팀 밖 평가자가 아직 매기지 않았다.` });
    }
  }

  // 5. 예상 기간이 지났는데 결과가 없다 (독촉하지 않는다: 계획을 다시 볼지 정하라는 안내)
  for (const p of props.filter((x) => (x.status === "sent" || x.status === "awaiting") && !submitted.has(x.id))) {
    const start = new Date(p.locked_at ?? p.created_at).getTime();
    const due = start + (Number(p.expected_weeks ?? 2) * 7 + 3) * DAY;
    if (now.getTime() > due) {
      const days = Math.floor((now.getTime() - due) / DAY);
      out.push({ kind: "proposal_overdue", severity: "mid", screen: "proposal", target: p.id, message: `"${p.method}" 제안이 예상 기간보다 ${days + 3}일 지났다. 계속 진행할지, 방법을 바꿀지 정한다.` });
    }
  }

  // 6. 판정이 나왔는데 결정을 기록하지 않았다 (7일 이상)
  const latestVerdict = new Map<string, (typeof verdicts)[number]>();
  for (const v of verdicts) if (!latestVerdict.has(v.hypothesis_id)) latestVerdict.set(v.hypothesis_id, v);
  for (const [hid, v] of latestVerdict) {
    const h = hyps.find((x) => x.id === hid);
    if (!h || h.status !== "in_progress" || v.result === "on_hold") continue;
    const decided = decisions.some((d) => d.hypothesis_id === hid && d.decided_at >= v.created_at);
    if (!decided && now.getTime() - new Date(v.created_at).getTime() > 7 * DAY) {
      out.push({ kind: "decision_pending", severity: "mid", screen: "decisions", target: hid, message: `"${short(h.statement)}" 판정이 나온 지 7일이 넘었지만 결정이 없다.` });
    }
  }

  // 7. 결정이 연결된 판정과 반대다
  for (const d of decisions) {
    const v = verdicts.find((x) => x.id === d.verdict_id);
    if (!v) continue;
    const against = (d.choice === "continue" && v.result === "not_met") || (d.choice === "stop" && v.result === "met");
    if (against) {
      const h = hyps.find((x) => x.id === d.hypothesis_id);
      out.push({
        kind: "decision_against_evidence",
        severity: "high",
        screen: "decisions",
        target: d.hypothesis_id,
        message: `"${short(h?.statement ?? "")}"는 판정이 '${v.result === "met" ? "충족" : "미달"}'인데 '${d.choice === "continue" ? "계속" : "중단"}'을 결정했다. 결정 사유를 확인한다.`,
      });
    }
  }

  // 8. 실무자 수요와 구매자 수요가 엇갈린다
  for (const g of diags) {
    const a = g.demand_verdict;
    const b = g.buyer_demand_verdict;
    if ((a === "met" && b === "not_met") || (a === "not_met" && b === "met")) {
      out.push({
        kind: "demand_split",
        severity: "high",
        screen: "diagnosis",
        target: g.id,
        message: `업무 "${g.tasks?.name ?? ""}": 실무자 수요는 ${a === "met" ? "충족" : "미달"}, 구매자 수요는 ${b === "met" ? "충족" : "미달"}이다. 쓰는 사람과 돈 내는 사람이 다르게 원한다.`,
      });
    }
  }

  // 9. 다시 검증해야 하는 가설 (예전 출시 후 측정에서 넘어온 상태)
  const recheck = hyps.filter((h) => h.status === "needs_recheck");
  if (recheck.length) {
    out.push({ kind: "needs_recheck", severity: "high", screen: "hypotheses", message: `다시 검증해야 하는 가설이 ${recheck.length}개 있다.` });
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

// ── 점검 주기 ──────────────────────────────────────────────────────
export interface Cycle {
  review_cycle_weeks: number;
  last_reviewed_at: string | null;
  next_review_at: string;
  overdue: boolean;
  days_left: number;
}

export function cycleOf(p: { review_cycle_weeks: number; last_reviewed_at: string | null; created_at: string }, now = new Date()): Cycle {
  const base = new Date(p.last_reviewed_at ?? p.created_at).getTime();
  const next = base + p.review_cycle_weeks * 7 * DAY;
  return {
    review_cycle_weeks: p.review_cycle_weeks,
    last_reviewed_at: p.last_reviewed_at,
    next_review_at: new Date(next).toISOString(),
    overdue: now.getTime() > next,
    days_left: Math.ceil((next - now.getTime()) / DAY),
  };
}

export async function reviewState(admin: Db, projectId: string) {
  const p = must(await admin.from("projects").select("review_cycle_weeks, last_reviewed_at, created_at").eq("id", projectId).maybeSingle(), "프로젝트");
  const { data: reviews } = await admin.from("reviews").select("id, note, snapshot, created_at, reviewed_by").eq("project_id", projectId).order("created_at", { ascending: false }).limit(10);
  return { cycle: cycleOf(p), warnings: await projectWarnings(admin, projectId), reviews: reviews ?? [] };
}

/** 점검 기록: 그 시점의 경고와 가설 상태를 남기고 다음 점검일을 다시 잡는다 */
export async function recordReview(admin: Db, projectId: string, userId: string, note: string) {
  const warnings = await projectWarnings(admin, projectId);
  const { data: hyps } = await admin.from("hypotheses").select("status").eq("project_id", projectId);
  const counts: Record<string, number> = {};
  for (const h of hyps ?? []) counts[h.status] = (counts[h.status] ?? 0) + 1;
  const review = must(
    await admin
      .from("reviews")
      .insert({ project_id: projectId, reviewed_by: userId, note, snapshot: { warnings, hypothesis_status_counts: counts } })
      .select("*")
      .single(),
  );
  await admin.from("projects").update({ last_reviewed_at: review.created_at }).eq("id", projectId);
  return { review, ...(await reviewState(admin, projectId)) };
}
