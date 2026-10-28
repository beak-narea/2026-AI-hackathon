// 계정: 이름·알림 설정, 내 데이터 내려받기(JSON), 계정 삭제
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, must } from "../api/handler";

const PROJECT_TABLES = [
  "business_models", "tasks", "diagnoses", "wrapper_items", "cost_models", "hypotheses", "criticality_ratings",
  "proposals", "evidence", "verdicts", "decisions", "transcripts", "insights", "metric_cards", "metric_observations",
  "cost_observations", "reviews", "pitch_drafts", "raw_files", "project_members", "baseline_tests",
] as const;

export async function getAccount(admin: Db, userId: string, email: string | null) {
  const { data } = await admin.from("profiles").select("display_name, email_notifications, terms_version, terms_accepted_at, data_use_accepted_at, created_at").eq("id", userId).maybeSingle();
  const { data: owned } = await admin.from("projects").select("id, name, status").eq("owner_id", userId);
  return { email, profile: data, owned_projects: owned ?? [] };
}

export async function updateAccount(admin: Db, userId: string, input: { display_name?: string; email_notifications?: boolean }) {
  return must(await admin.from("profiles").update(input).eq("id", userId).select("display_name, email_notifications").single());
}

/** 내가 만든 프로젝트의 모든 기록 (가명 키는 넣지 않는다: 원래 이름은 서비스 밖으로 나가지 않는다) */
export async function exportAccount(admin: Db, userId: string) {
  const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle();
  const projects = must(await admin.from("projects").select("*").eq("owner_id", userId)) as Array<{ id: string }>;
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), profile, projects: [] as unknown[] };
  for (const p of projects) {
    const entry: Record<string, unknown> = { project: p };
    for (const t of PROJECT_TABLES) {
      const { data } = await admin.from(t).select("*").eq("project_id", p.id);
      entry[t] = data ?? [];
    }
    (out.projects as unknown[]).push(entry);
  }
  const { data: notifications } = await admin.from("notifications").select("*").eq("user_id", userId);
  out.notifications = notifications ?? [];
  return out;
}

/** 계정 삭제: 내가 만든 프로젝트와 그 기록을 모두 지운다 (되돌릴 수 없다) */
export async function deleteAccount(admin: Db, userId: string, confirm: string) {
  if (confirm !== "계정 삭제") throw badRequest("확인 문구로 '계정 삭제'를 입력한다");
  const projects = must(await admin.from("projects").select("id").eq("owner_id", userId).eq("is_example", false)) as Array<{ id: string }>;
  for (const p of projects) {
    const { data: raws } = await admin.from("raw_files").select("path").eq("project_id", p.id).is("deleted_at", null);
    const paths = (raws ?? []).map((r: { path: string }) => r.path);
    if (paths.length) await admin.storage.from("raw-files").remove(paths);
    await admin.from("projects").delete().eq("id", p.id);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  return { deleted: true, projects_deleted: projects.length };
}
