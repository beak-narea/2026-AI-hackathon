// 원자료 관리: 목록, 내려받기, 삭제, 보관 기간이 지난 파일 정리
import "server-only";
import type { Db } from "../supabase/server";
import { conflict, must } from "../api/handler";

const BUCKET = "raw-files";

export async function listRawFiles(admin: Db, projectId: string) {
  const { data } = await admin
    .from("raw_files")
    .select("id, proposal_id, path, name, kind, size_bytes, pseudonymized, deleted_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  const p = must(await admin.from("projects").select("raw_retention_days").eq("id", projectId).maybeSingle(), "프로젝트");
  const days = Number(p.raw_retention_days);
  return {
    retention_days: days,
    files: ((data ?? []) as Array<{ id: string; path: string; name: string; created_at: string; deleted_at: string | null }>).map((f) => ({
      ...f,
      expires_at: f.deleted_at ? null : new Date(new Date(f.created_at).getTime() + days * 86_400_000).toISOString(),
    })),
  };
}

export async function downloadRawFile(admin: Db, projectId: string, fileId: string) {
  const f = must(await admin.from("raw_files").select("*").eq("id", fileId).eq("project_id", projectId).maybeSingle(), "원자료");
  if (f.deleted_at) throw conflict("삭제된 파일이다");
  const { data, error } = await admin.storage.from(BUCKET).download(f.path as string);
  if (error || !data) throw conflict("저장소에서 파일을 찾지 못했다");
  return { blob: data as Blob, name: f.name as string };
}

export async function deleteRawFile(admin: Db, projectId: string, fileId: string) {
  const f = must(await admin.from("raw_files").select("*").eq("id", fileId).eq("project_id", projectId).maybeSingle(), "원자료");
  if (!f.deleted_at) {
    await admin.storage.from(BUCKET).remove([f.path as string]);
    await admin.from("raw_files").update({ deleted_at: new Date().toISOString() }).eq("id", fileId);
  }
  return { deleted: fileId };
}

/** 예약 작업: 프로젝트별 보관 기간이 지난 원자료를 지운다 (집계·판정 숫자는 남는다) */
export async function purgeExpiredRawFiles(admin: Db, now = new Date()) {
  const { data } = await admin.from("raw_files").select("id, project_id, path, created_at, projects(raw_retention_days)").is("deleted_at", null);
  let purged = 0;
  for (const f of (data ?? []) as unknown as Array<{ id: string; project_id: string; path: string; created_at: string; projects: { raw_retention_days: number } | null }>) {
    const days = Number(f.projects?.raw_retention_days ?? 365);
    if (now.getTime() - new Date(f.created_at).getTime() > days * 86_400_000) {
      await admin.storage.from(BUCKET).remove([f.path]);
      await admin.from("raw_files").update({ deleted_at: now.toISOString() }).eq("id", f.id);
      purged++;
    }
  }
  return { purged };
}
