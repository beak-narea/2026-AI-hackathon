import "server-only";
import type { Db } from "../supabase/server";
import { must, notFound } from "../api/handler";

export async function listProjects(admin: Db, userId: string) {
  const { data: memberships } = await admin.from("project_members").select("project_id, role").eq("user_id", userId);
  const ids = (memberships ?? []).map((m) => m.project_id);
  const own = ids.length
    ? must(await admin.from("projects").select("*").in("id", ids).order("updated_at", { ascending: false }))
    : [];
  const examples = must(await admin.from("projects").select("*").eq("is_example", true));
  const roles = Object.fromEntries((memberships ?? []).map((m) => [m.project_id, m.role]));
  return {
    examples,
    projects: own.map((p: Record<string, unknown>) => ({ ...p, my_role: roles[p.id as string] ?? null })),
  };
}

export async function createProject(admin: Db, userId: string, input: { name: string; idea_text: string; is_b2b: boolean }) {
  return must(
    await admin
      .from("projects")
      .insert({ owner_id: userId, name: input.name, idea_text: input.idea_text, is_b2b: input.is_b2b })
      .select("*")
      .single(),
  );
}

/** 대시보드: 가설 상태 요약, 대기 중인 검증 제안, 최근 판정, 다음 할 일 */
export async function dashboard(admin: Db, projectId: string) {
  const project = must(await admin.from("projects").select("*").eq("id", projectId).maybeSingle(), "프로젝트");
  const [hyps, proposals, verdicts, bm] = await Promise.all([
    admin.from("hypotheses").select("id, statement, type, criticality, evidence_level, status, rank").eq("project_id", projectId),
    admin
      .from("proposals")
      .select("id, hypothesis_id, method, status, look_number, locked_at, sample_size, expected_weeks, created_at")
      .eq("project_id", projectId)
      .in("status", ["sent", "awaiting"]),
    admin
      .from("verdicts")
      .select("id, hypothesis_id, result, look_number, n, successes, evidence_level, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(5),
    admin.from("business_models").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1),
  ]);
  const hypotheses = hyps.data ?? [];
  const statusCounts: Record<string, number> = {};
  for (const h of hypotheses) statusCounts[h.status] = (statusCounts[h.status] ?? 0) + 1;

  const next: { action: string; label: string; target?: string }[] = [];
  if (!bm.data?.length) next.push({ action: "business_model.extract", label: "사업 모델 만들기" });
  else if (!hypotheses.length) next.push({ action: "hypothesis.create", label: "위험 가정 뽑기" });
  const unrated = hypotheses.filter((h) => !h.criticality);
  if (unrated.length) next.push({ action: "hypothesis.rate_criticality", label: `중요도 매기기 (${unrated.length}개)` });
  const pendingDecision = (verdicts.data ?? []).filter(
    (v) => hypotheses.find((h) => h.id === v.hypothesis_id)?.status === "in_progress",
  );
  const statement = (id: string) => hypotheses.find((h) => h.id === id)?.statement ?? "";
  const decided = new Set<string>();
  for (const v of pendingDecision) {
    if (decided.has(v.hypothesis_id)) continue;
    decided.add(v.hypothesis_id);
    next.push({ action: "decision.record", label: `결정 기록: ${statement(v.hypothesis_id)}`, target: v.hypothesis_id });
  }
  for (const p of proposals.data ?? []) {
    next.push({ action: "evidence.submit", label: `결과 제출: ${statement(p.hypothesis_id)}`, target: p.id });
  }

  return {
    project,
    hypothesis_status_counts: statusCounts,
    pending_proposals: proposals.data ?? [],
    recent_verdicts: verdicts.data ?? [],
    next_actions: next,
  };
}

export async function archiveProject(admin: Db, projectId: string, reason: string) {
  const r = await admin
    .from("projects")
    .update({ status: "archived", archived_at: new Date().toISOString(), archive_reason: reason })
    .eq("id", projectId)
    .eq("is_example", false)
    .select("*")
    .maybeSingle();
  if (!r.data) throw notFound("프로젝트");
  return r.data;
}

export async function restoreProject(admin: Db, projectId: string) {
  return must(
    await admin
      .from("projects")
      .update({ status: "active", archived_at: null, archive_reason: null })
      .eq("id", projectId)
      .eq("is_example", false)
      .select("*")
      .maybeSingle(),
    "프로젝트",
  );
}
