// 6번 기능: 출시 전 검증과 출시 후 측정 연결 — 지표 카드, 추적 계획 내보내기, 재검증, 실제 AI 비용 비교.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import yaml from "js-yaml";
import type { Db } from "../supabase/server";
import { badRequest, conflict, must, mustAffect } from "../api/handler";
import { assertThresholds, judge } from "../stats/verdict";

export async function updateMetricCard(
  admin: Db,
  projectId: string,
  cardId: string,
  input: { event_name?: string; definition?: string; target_value?: number; min_value?: number; alert_rule?: string },
) {
  const card = must(await admin.from("metric_cards").select("*").eq("id", cardId).eq("project_id", projectId).maybeSingle(), "지표 카드");
  if (card.locked_at) throw conflict("잠근 지표 카드는 바꿀 수 없다");
  const target = input.target_value ?? Number(card.target_value);
  const min = input.min_value ?? Number(card.min_value);
  assertThresholds({ target, min });
  return must(await admin.from("metric_cards").update(input).eq("id", cardId).select("*").single());
}

export async function lockMetricCard(admin: Db, projectId: string, cardId: string) {
  const card = must(await admin.from("metric_cards").select("*").eq("id", cardId).eq("project_id", projectId).maybeSingle(), "지표 카드");
  if (card.locked_at) throw conflict("이미 잠근 카드다");
  // 출시 전 제안의 기준과 다르면 "다시 정해 잠갔다"고 표시
  const { data: verdict } = await admin
    .from("verdicts")
    .select("target_value, min_value")
    .eq("hypothesis_id", card.hypothesis_id)
    .eq("result", "met")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const relocked = !!verdict && (Number(verdict.target_value) !== Number(card.target_value) || Number(verdict.min_value) !== Number(card.min_value));
  return must(
    await admin.from("metric_cards").update({ locked_at: new Date().toISOString(), relocked }).eq("id", cardId).select("*").single(),
  );
}

/** 관측값으로 출시 전과 같은 3갈래 판정. 미달이면 가설을 "재검증 필요"로 되돌린다. 보류면 관찰 기간을 늘린다. */
export async function recordObservation(
  admin: Db,
  projectId: string,
  cardId: string,
  obs: { successes: number; n: number; period_start?: string; period_end?: string; source?: string },
) {
  const card = must(await admin.from("metric_cards").select("*").eq("id", cardId).eq("project_id", projectId).maybeSingle(), "지표 카드");
  if (!card.locked_at) throw conflict("지표 카드를 잠근 뒤에 관측값을 받는다");
  if (obs.successes > obs.n) throw badRequest("성공 수는 표본 수보다 클 수 없다");
  const v = judge({ successes: obs.successes, n: obs.n, target: Number(card.target_value), min: Number(card.min_value), look: 1 });
  const row = must(
    await admin
      .from("metric_observations")
      .insert({
        project_id: projectId,
        metric_card_id: cardId,
        successes: obs.successes,
        n: obs.n,
        period_start: obs.period_start ?? null,
        period_end: obs.period_end ?? null,
        source: obs.source ?? "manual",
        result: v.result,
        p_above_target: v.pAboveTarget,
        p_below_min: v.pBelowMin,
      })
      .select("*")
      .single(),
  );
  await admin
    .from("metric_cards")
    .update({ actual_value: obs.successes / obs.n, actual_n: obs.n, recheck_result: v.result, observed_at: new Date().toISOString() })
    .eq("id", cardId);
  if (v.result === "not_met") {
    await admin.from("hypotheses").update({ status: "needs_recheck" }).eq("id", card.hypothesis_id).eq("project_id", projectId);
  }
  return {
    observation: row,
    verdict: v,
    note: v.result === "on_hold" ? "판정 보류: 관찰 기간을 늘린다" : v.result === "not_met" ? "가설을 '재검증 필요'로 되돌렸다" : null,
  };
}

export async function trackingPlan(admin: Db, projectId: string, format: "yaml" | "csv") {
  const project = must(await admin.from("projects").select("name").eq("id", projectId).maybeSingle(), "프로젝트");
  const cards = must(
    await admin.from("metric_cards").select("*, hypotheses(statement)").eq("project_id", projectId).order("created_at"),
  ) as Array<Record<string, unknown> & { hypotheses: { statement: string } | null }>;
  const events = cards.map((c) => ({
    name: c.event_name as string,
    description: c.definition as string,
    hypothesis: c.hypotheses?.statement ?? "",
    target: Number(c.target_value),
    min_acceptable: Number(c.min_value),
    alert: c.alert_rule as string,
    locked: !!c.locked_at,
  }));
  if (format === "yaml") {
    return {
      body: yaml.dump({ version: 1, project: project.name, generated_at: new Date().toISOString(), events }, { lineWidth: 120 }),
      contentType: "application/x-yaml; charset=utf-8",
      filename: "tracking-plan.yaml",
    };
  }
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["name", "description", "hypothesis", "target", "min_acceptable", "alert", "locked"];
  const lines = [header.join(","), ...events.map((e) => header.map((h) => esc(e[h as keyof typeof e])).join(","))];
  // 엑셀에서 한글이 깨지지 않게 BOM을 붙인다
  return { body: `﻿${lines.join("\r\n")}`, contentType: "text/csv; charset=utf-8", filename: "tracking-plan.csv" };
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
