// 원자료 관리: 목록, 내려받기, 삭제, 보관 기간이 지난 파일 정리
import "server-only";
import type { Db } from "../supabase/server";
import { conflict, must } from "../api/handler";
import { selectAll } from "../supabase/paging";

const BUCKET = "raw-files";

export async function listRawFiles(admin: Db, projectId: string) {
  const data = await selectAll<Record<string, unknown>>((f, t) =>
    admin
      .from("raw_files")
      .select("id, proposal_id, path, name, kind, size_bytes, pseudonymized, deleted_at, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(f, t),
  );
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
    const { error } = await admin.storage.from(BUCKET).remove([f.path as string]);
    if (error) throw new Error(`저장소에서 지우지 못했다: ${error.message}`);
    await admin.from("raw_files").update({ deleted_at: new Date().toISOString() }).eq("id", fileId);
  }
  return { deleted: fileId };
}

const PURGE_BATCH = 100;

/** 예약 작업: 프로젝트별 보관 기간이 지난 원자료를 지운다 (집계·판정 숫자는 남는다).
 *  DB 함수로 지난 것만 골라 100개씩 (주소 길이 제한 안에서), 시간 예산 안에서. 저장소에서 지운 것만 지움 표시를 한다. */
export async function purgeExpiredRawFiles(admin: Db, now = new Date(), deadline = Date.now() + 60_000) {
  let purged = 0;
  let failed = 0;
  while (Date.now() < deadline) {
    const { data, error } = await admin.rpc("expired_raw_files", { lim: PURGE_BATCH });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id: string; path: string }>;
    if (!rows.length) break;
    const { error: removeError } = await admin.storage.from(BUCKET).remove(rows.map((r) => r.path));
    if (removeError) {
      failed += rows.length;
      console.error("[purge]", removeError.message);
      break;
    }
    const { error: markError } = await admin.from("raw_files").update({ deleted_at: now.toISOString() }).in("id", rows.map((r) => r.id));
    if (markError) throw new Error(markError.message);
    purged += rows.length;
    if (rows.length < PURGE_BATCH) break;
  }
  return { purged, failed };
}
