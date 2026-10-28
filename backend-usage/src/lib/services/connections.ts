// 데이터 연결과 실사용 지표 보조: 수신 토큰, 추적 계획 내보내기, 실제 AI 비용 비교.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import yaml from "js-yaml";
import type { Db } from "../supabase/server";
import { must, mustAffect } from "../api/handler";
import { isUsageMethod } from "../domain/experiments";
import type { MetricSource } from "./proposals";

/** 실사용 지표 기획서들의 분자·분모 이벤트를 개발팀에 넘길 추적 계획으로 */
export async function trackingPlan(admin: Db, projectId: string, format: "yaml" | "csv") {
  const project = must(await admin.from("projects").select("name").eq("id", projectId).maybeSingle(), "프로젝트");
  const rows = must(
    await admin
      .from("proposals")
      .select("id, method_key, metric_source, target_value, min_value, locked_at, root_proposal_id, hypotheses(statement)")
      .eq("project_id", projectId)
      .is("root_proposal_id", null)
      .not("metric_source", "is", null)
      .order("created_at"),
  ) as unknown as Array<{ id: string; method_key: string; metric_source: MetricSource; target_value: number; min_value: number; locked_at: string | null; hypotheses: { statement: string } | null }>;
  const metrics = rows.filter((r) => isUsageMethod(r.method_key)).map((r) => ({
    numerator_event: r.metric_source.numerator_event,
    denominator_event: r.metric_source.denominator_event,
    window_days: r.metric_source.window_days,
    hypothesis: r.hypotheses?.statement ?? "",
    target: Number(r.target_value),
    min_acceptable: Number(r.min_value),
    locked: !!r.locked_at,
    proposal_id: r.id,
  }));
  if (format === "yaml") {
    return {
      body: yaml.dump({ version: 2, project: project.name, generated_at: new Date().toISOString(), metrics }, { lineWidth: 120 }),
      contentType: "application/x-yaml; charset=utf-8",
      filename: "tracking-plan.yaml",
    };
  }
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["numerator_event", "denominator_event", "window_days", "hypothesis", "target", "min_acceptable", "locked", "proposal_id"];
  const lines = [header.join(","), ...metrics.map((e) => header.map((h) => esc(e[h as keyof typeof e])).join(","))];
  // 엑셀에서 한글이 깨지지 않게 BOM을 붙인다
  return { body: `\uFEFF${lines.join("\r\n")}`, contentType: "text/csv; charset=utf-8", filename: "tracking-plan.csv" };
}

// ── 데이터 연결: 고객사 도구가 값을 보내는 수신 토큰 ─────────────────
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function addConnection(
  admin: Db,
  projectId: string,
  input: { tool_name: string; kind: "analytics" | "llm_monitoring"; config?: Record<string, unknown> },
) {
  const conn = must(
    await admin
      .from("data_connections")
      .insert({ project_id: projectId, tool_name: input.tool_name, kind: input.kind, config: input.config ?? {}, status: "connected" })
      .select("*")
      .single(),
  );
  const token = `vs_${randomBytes(24).toString("base64url")}`;
  const secret = await admin.from("connection_secrets").insert({ connection_id: conn.id, token_hash: hashToken(token) }).select("connection_id");
  if (secret.error) {
    // 토큰 없는 연결이 남지 않게
    await admin.from("data_connections").delete().eq("id", conn.id);
    must(secret);
  }
  // 토큰 원문은 이번 응답에서 한 번만 보여준다
  return { connection: conn, ingest_token: token, ingest_url: "/api/ingest" };
}

export async function removeConnection(admin: Db, projectId: string, connectionId: string) {
  mustAffect(await admin.from("data_connections").delete().eq("id", connectionId).eq("project_id", projectId).select("id"), "데이터 연결");
  return { removed: connectionId };
}

/** 실제 AI 비용 vs 비용 계산기 가정 */
export async function costComparison(admin: Db, projectId: string) {
  const { data: model } = await admin
    .from("cost_models")
    .select("results")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: obs } = await admin
    .from("cost_observations")
    .select("*")
    .eq("project_id", projectId)
    .order("period_end", { ascending: false })
    .limit(6);
  const assumed = (model?.results as { costPerTask?: { model: number } } | undefined)?.costPerTask?.model ?? null;
  return {
    assumed_cost_per_task: assumed,
    observations: (obs ?? []).map((o) => {
      const actual = Number(o.total_cost_krw) / Number(o.tasks);
      return { ...o, actual_cost_per_task: actual, diff_ratio: assumed ? actual / assumed - 1 : null };
    }),
  };
}
