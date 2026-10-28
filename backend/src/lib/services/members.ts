import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must } from "../api/handler";
import { serverEnv } from "../env";

export async function inviteMember(
  admin: Db,
  projectId: string,
  input: { email: string; name: string; role: "member" | "external_rater" },
) {
  const email = input.email.trim().toLowerCase();
  const { data: existingId } = await admin.rpc("user_id_by_email", { e: email });
  const existing = existingId ? { id: existingId as string } : null;
  const { data, error } = await admin
    .from("project_members")
    .insert({
      project_id: projectId,
      email,
      name: input.name,
      role: input.role,
      user_id: existing?.id ?? null,
      joined_at: existing ? new Date().toISOString() : null,
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw conflict("이미 초대한 이메일이다");
  if (error) throw error;
  if (!existing) {
    const env = serverEnv();
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${env.APP_URL}/auth/callback?next=/projects/${projectId}`,
      data: { name: input.name },
    });
    if (inviteError) return { member: data, invite_email_sent: false, invite_error: inviteError.message };
  }
  return { member: data, invite_email_sent: !existing };
}

export async function removeMember(admin: Db, projectId: string, memberId: string) {
  const m = must(await admin.from("project_members").select("*").eq("id", memberId).eq("project_id", projectId).maybeSingle(), "멤버");
  if (m.role === "owner") throw badRequest("소유자는 내보낼 수 없다");
  must(await admin.from("project_members").delete().eq("id", memberId).select("id"));
  return { removed: memberId };
}
