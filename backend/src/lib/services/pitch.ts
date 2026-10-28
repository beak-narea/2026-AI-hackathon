// 판매 테스트용 피치·데모 초안 (기획 4.3.4). 초안만 제안하고 제작·실행은 고객 팀이 한다.
import "server-only";
import type { Db } from "../supabase/server";
import { badRequest, must } from "../api/handler";
import { methodByKey } from "../domain/experiments";
import { llmFor } from "../llm/factory";
import { pitchPrompt } from "../llm/prompts";
import { canvasText, latestBusinessModel } from "./diagnosis";

export async function draftPitch(admin: Db, projectId: string, proposalId: string, userId: string) {
  const p = must(await admin.from("proposals").select("id, hypothesis_id, method_key").eq("id", proposalId).eq("project_id", projectId).maybeSingle(), "검증 제안");
  const method = methodByKey(p.method_key as string);
  if (!method) throw badRequest("이 제안의 방법은 피치 초안을 지원하지 않는다");
  const h = must(await admin.from("hypotheses").select("statement").eq("id", p.hypothesis_id).maybeSingle(), "가설");
  const bm = await latestBusinessModel(admin, projectId);
  const content = await llmFor(admin, projectId, userId).structured(pitchPrompt(h.statement as string, method, canvasText(bm)));
  return must(
    await admin
      .from("pitch_drafts")
      .insert({ project_id: projectId, proposal_id: proposalId, hypothesis_id: p.hypothesis_id, content, created_by: userId })
      .select("*")
      .single(),
  );
}

export async function listPitches(admin: Db, projectId: string, proposalId: string) {
  const { data } = await admin.from("pitch_drafts").select("*").eq("project_id", projectId).eq("proposal_id", proposalId).order("created_at", { ascending: false });
  return { pitches: data ?? [] };
}
