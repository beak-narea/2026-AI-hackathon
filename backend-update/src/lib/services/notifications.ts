// 알림: 화면 알림(notifications)과 선택적 메일(Resend). 같은 dedupe_key는 한 번만 보낸다.
import "server-only";
import type { Db } from "../supabase/server";
import { serverEnv } from "../env";

export interface NotifyInput {
  userId: string;
  projectId?: string | null;
  kind: string;
  title: string;
  body?: string;
  link?: string | null;
  dedupeKey?: string;
  email?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendMail(to: string, subject: string, text: string, link?: string | null): Promise<boolean> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY) return false;
  const url = link ? new URL(link, env.APP_URL).toString() : null;
  const html = `<div style="font-family:sans-serif;line-height:1.6"><p>${esc(text).replace(/\n/g, "<br>")}</p>${
    url ? `<p><a href="${esc(url)}">검증실에서 열기</a></p>` : ""
  }<p style="color:#888;font-size:12px">검증실 알림 메일입니다. 알림 설정은 계정 화면에서 바꿀 수 있습니다.</p></div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: `[검증실] ${subject}`, html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error("[mail]", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e) {
    console.error("[mail]", (e as Error).message);
    return false;
  }
}

async function emailOf(admin: Db, userId: string): Promise<string | null> {
  const { data } = await admin.from("project_members").select("email").eq("user_id", userId).limit(1).maybeSingle();
  if (data?.email) return data.email as string;
  try {
    const r = await (admin.auth as unknown as { admin: { getUserById?: (id: string) => Promise<{ data: { user: { email?: string } | null } }> } }).admin.getUserById?.(userId);
    return r?.data.user?.email ?? null;
  } catch {
    return null;
  }
}

export async function notify(admin: Db, n: NotifyInput): Promise<{ created: boolean }> {
  const { data: prefs } = await admin.from("profiles").select("email_notifications").eq("id", n.userId).maybeSingle();
  const row = {
    user_id: n.userId,
    project_id: n.projectId ?? null,
    kind: n.kind,
    title: n.title,
    body: n.body ?? "",
    link: n.link ?? null,
    dedupe_key: n.dedupeKey ?? null,
  };
  const { data, error } = await admin.from("notifications").insert(row).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") return { created: false }; // 이미 보낸 알림
    console.error("[notify]", error.message);
    return { created: false };
  }
  const wantsMail = n.email !== false && (prefs?.email_notifications ?? true);
  if (wantsMail && data) {
    const to = await emailOf(admin, n.userId);
    if (to && (await sendMail(to, n.title, n.body ?? n.title, n.link))) {
      await admin.from("notifications").update({ emailed: true }).eq("id", data.id);
    }
  }
  return { created: true };
}

/** 프로젝트의 owner·member 모두에게 */
export async function notifyProject(admin: Db, projectId: string, n: Omit<NotifyInput, "userId" | "projectId">) {
  const { data } = await admin.from("project_members").select("user_id, role").eq("project_id", projectId);
  const users = (data ?? []).filter((m: { user_id: string | null; role: string }) => m.user_id && m.role !== "external_rater");
  for (const m of users) await notify(admin, { ...n, userId: m.user_id as string, projectId });
}

export async function listNotifications(admin: Db, userId: string) {
  const { data } = await admin
    .from("notifications")
    .select("id, project_id, kind, title, body, link, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const items = data ?? [];
  return { notifications: items, unread: items.filter((i: { read_at: string | null }) => !i.read_at).length };
}

export async function markRead(admin: Db, userId: string, ids: string[] | "all") {
  let q = admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
  if (ids !== "all") q = q.in("id", ids);
  await q.select("id");
  return { ok: true };
}
