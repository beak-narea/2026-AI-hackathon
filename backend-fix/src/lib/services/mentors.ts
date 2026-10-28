// 외부 평가자 연결: 팀이 직접 구하지 못하면 제휴 멘토를 연결한다 (치명 판정에는 팀 밖 1명이 필요).
// 연결 비용(평가 수당)은 우리 서비스 비용 구조의 변동비로 잡힌다.
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must } from "../api/handler";
import { serverEnv, isDemo } from "../env";
import { inviteMember } from "./members";
import { notify, notifyProject, sendMail } from "./notifications";

export async function requestMentor(admin: Db, projectId: string, userId: string, input: { hypothesis_id?: string | null; topic: string }) {
  if (input.hypothesis_id) {
    must(await admin.from("hypotheses").select("id").eq("id", input.hypothesis_id).eq("project_id", projectId).maybeSingle(), "가설");
  }
  const { count } = await admin
    .from("mentor_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "requested");
  if ((count ?? 0) >= 3) throw conflict("처리를 기다리는 요청이 이미 3개 있다");
  const req = must(
    await admin
      .from("mentor_requests")
      .insert({ project_id: projectId, hypothesis_id: input.hypothesis_id ?? null, requested_by: userId, topic: input.topic.slice(0, 1000) })
      .select("*")
      .single(),
  );
  await notifyAdmins(admin, "외부 평가자 연결 요청", `새 요청: ${input.topic || "(주제 없음)"}`, "/admin/mentors", `mentor_request:${req.id}`);
  return req;
}

async function notifyAdmins(admin: Db, title: string, body: string, link: string, key: string) {
  const emails = isDemo()
    ? ["demo@example.com"]
    : serverEnv()
        .ADMIN_EMAILS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  for (const email of emails) {
    const { data: id } = await admin.rpc("user_id_by_email", { e: email });
    if (id) await notify(admin, { userId: id as string, kind: "admin", title, body, link, dedupeKey: key });
    else await sendMail(email, title, body, link);
  }
}

export async function listProjectRequests(admin: Db, projectId: string) {
  const { data } = await admin
    .from("mentor_requests")
    .select("id, hypothesis_id, topic, status, fee_krw, created_at, mentors(name, organization)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return { requests: data ?? [] };
}

export async function cancelRequest(admin: Db, projectId: string, requestId: string) {
  return must(
    await admin
      .from("mentor_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("project_id", projectId)
      .eq("status", "requested")
      .select("*")
      .maybeSingle(),
    "요청",
  );
}

// ── 운영자 ──────────────────────────────────────────────────────────
export async function listMentors(admin: Db) {
  const [m, r] = await Promise.all([
    admin.from("mentors").select("*").order("created_at", { ascending: false }),
    admin
      .from("mentor_requests")
      .select("*, projects(name), hypotheses(statement), mentors(name)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  return { mentors: m.data ?? [], requests: r.data ?? [] };
}

export async function upsertMentor(
  admin: Db,
  input: { id?: string; name: string; email: string; organization?: string; expertise?: string[]; fee_krw?: number; active?: boolean },
) {
  const row = { ...input, email: input.email.trim().toLowerCase() };
  if (input.id) return must(await admin.from("mentors").update(row).eq("id", input.id).select("*").single());
  const { data, error } = await admin.from("mentors").insert(row).select("*").single();
  if (error?.code === "23505") throw conflict("이미 등록한 이메일이다");
  if (error) throw error;
  return data;
}

/** 요청에 멘토를 배정: 프로젝트에 외부 평가자로 초대하고 팀에 알린다 */
export async function matchRequest(admin: Db, requestId: string, mentorId: string) {
  const req = must(await admin.from("mentor_requests").select("*").eq("id", requestId).maybeSingle(), "요청");
  if (req.status !== "requested") throw conflict("이미 처리한 요청이다");
  const mentor = must(await admin.from("mentors").select("*").eq("id", mentorId).maybeSingle(), "멘토");
  if (!mentor.active) throw badRequest("활동하지 않는 멘토다");
  let invite: unknown = null;
  try {
    invite = await inviteMember(admin, req.project_id as string, { email: mentor.email as string, name: mentor.name as string, role: "external_rater" });
  } catch (e) {
    if ((e as { status?: number }).status !== 409) throw e; // 이미 초대된 경우는 그대로 진행
    invite = { already_member: true };
  }
  const updated = must(
    await admin
      .from("mentor_requests")
      .update({ mentor_id: mentorId, status: "matched", fee_krw: mentor.fee_krw, updated_at: new Date().toISOString() })
      .eq("id", requestId)
      .select("*")
      .single(),
  );
  await notifyProject(admin, req.project_id as string, {
    kind: "mentor_matched",
    title: "외부 평가자가 연결됐습니다",
    body: `${mentor.name}${mentor.organization ? ` (${mentor.organization})` : ""}님을 외부 평가자로 초대했습니다. 치명 후보 가설의 중요도를 함께 매기게 됩니다.`,
    link: `/projects/${req.project_id}/hypotheses`,
    dedupeKey: `mentor_matched:${requestId}`,
  });
  return { request: updated, invite };
}

export async function closeRequest(admin: Db, requestId: string, status: "done" | "cancelled") {
  return must(
    await admin.from("mentor_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", requestId).select("*").single(),
  );
}
