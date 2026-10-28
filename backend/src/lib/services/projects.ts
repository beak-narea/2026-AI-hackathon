import "server-only";
import type { Db } from "../supabase/server";
import { selectAll, selectIn } from "../supabase/paging";
import { badRequest, conflict, must, notFound } from "../api/handler";

export async function listProjects(admin: Db, userId: string) {
  const { data: memberships } = await admin.from("project_members").select("project_id, role").eq("user_id", userId);
  const ids = (memberships ?? []).map((m) => m.project_id);
  const own = ids.length
    ? must(await admin.from("projects").select("*").in("id", ids).order("updated_at", { ascending: false }))
    : [];
  const examples = must(await admin.from("projects").select("*").eq("is_example", true));
  const roles = Object.fromEntries((memberships ?? []).map((m) => [m.project_id, m.role]));
  const phases = await projectPhases(admin, [...own, ...examples] as Array<{ id: string; status: string }>);
  return {
    examples: examples.map((p: Record<string, unknown>) => ({ ...p, phase: phases[p.id as string] })),
    projects: own.map((p: Record<string, unknown>) => ({ ...p, my_role: roles[p.id as string] ?? null, phase: phases[p.id as string] })),
  };
}

/**
 * 프로젝트 단계 (목록에 표시)
 * - closed(마감): 보관함으로 옮긴 프로젝트
 * - running(진행 중): 기준을 잠근 검증 제안이 하나라도 있다 = 실험을 돌리고 있다
 * - planning(계획): 사업 모델·진단·가설·기획서를 준비하는 중
 */
export type ProjectPhase = "planning" | "running" | "closed";

export async function projectPhases(admin: Db, projects: Array<{ id: string; status: string }>): Promise<Record<string, ProjectPhase>> {
  const open = projects.filter((p) => p.status !== "archived").map((p) => p.id);
  const locked = await selectIn<{ project_id: string }>(open, (chunk, from, to) =>
    admin.from("proposals").select("project_id").in("project_id", chunk).not("locked_at", "is", null).order("id").range(from, to),
  );
  const running = new Set(locked.map((r) => r.project_id));
  return Object.fromEntries(
    projects.map((p) => [p.id, p.status === "archived" ? "closed" : running.has(p.id) ? "running" : "planning"] as const),
  );
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

/** 프로젝트와 그 기록을 모두 지운다 (되돌릴 수 없다). 저장소 파일(원자료, 피치덱·사진 원본, 기획서 PDF)을 먼저 지우고 DB 행은 연쇄 삭제한다. */
export async function purgeProject(admin: Db, projectId: string) {
  const raws = await selectAll<{ path: string }>((f, to) =>
    admin.from("raw_files").select("path").eq("project_id", projectId).is("deleted_at", null).order("path").range(f, to),
  );
  const sources = await selectAll<{ storage_path: string }>((f, to) =>
    admin.from("source_files").select("storage_path").eq("project_id", projectId).order("storage_path").range(f, to),
  );
  const pdfs = await selectAll<{ pdf_path: string | null }>((f, to) =>
    admin.from("proposals").select("pdf_path").eq("project_id", projectId).not("pdf_path", "is", null).order("id").range(f, to),
  );
  for (const [bucket, paths] of [
    ["raw-files", raws.map((r) => r.path)],
    ["source-files", sources.map((r) => r.storage_path)],
    ["proposal-pdfs", pdfs.map((r) => r.pdf_path!).filter(Boolean)],
  ] as const) {
    for (let i = 0; i < paths.length; i += 500) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 500));
      if (error) throw new Error(`저장소 파일을 지우지 못해 삭제를 멈췄다 (${bucket}): ${error.message}`);
    }
  }
  const del = await admin.from("projects").delete().eq("id", projectId).select("id");
  if (del.error) throw new Error(`프로젝트를 지우지 못했다: ${del.error.message}`);
  return { deleted: projectId, files_removed: raws.length + sources.length + pdfs.length };
}

/** 소유자가 프로젝트 하나를 지운다. 실수로 지우지 않게 프로젝트 이름을 그대로 적어야 한다. */
export async function deleteProject(admin: Db, projectId: string, confirmName: string) {
  const p = must(await admin.from("projects").select("id, name, is_example").eq("id", projectId).maybeSingle(), "프로젝트");
  if (p.is_example) throw conflict("예시 프로젝트는 지울 수 없다");
  if (confirmName.trim() !== String(p.name).trim()) throw badRequest("확인을 위해 프로젝트 이름을 그대로 입력한다");
  return purgeProject(admin, projectId);
}
