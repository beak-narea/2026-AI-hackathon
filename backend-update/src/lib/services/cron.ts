// 매일 도는 예약 작업
import "server-only";
import type { Db } from "../supabase/server";
import { syncAll } from "./sync";
import { purgeExpiredRawFiles } from "./rawFiles";
import { cycleOf, projectWarnings } from "./review";
import { notifyProject } from "./notifications";

export async function runDaily(admin: Db, now = new Date()) {
  const started = Date.now();
  const sync = await syncAll(admin).catch((e) => ({ error: (e as Error).message }));

  // 점검 주기가 지났거나 예상 기간이 지난 제안이 있으면 팀에 알린다 (같은 주에는 한 번만)
  const week = `${now.getUTCFullYear()}-w${Math.floor((now.getTime() / 86_400_000 + 4) / 7)}`;
  const { data: projects } = await admin
    .from("projects")
    .select("id, name, review_cycle_weeks, last_reviewed_at, created_at")
    .eq("is_example", false)
    .eq("status", "active");
  let notified = 0;
  for (const p of (projects ?? []) as Array<{ id: string; name: string; review_cycle_weeks: number; last_reviewed_at: string | null; created_at: string }>) {
    const cycle = cycleOf(p, now);
    if (cycle.overdue) {
      await notifyProject(admin, p.id, {
        kind: "review_due",
        title: `점검할 때입니다: ${p.name}`,
        body: `${p.review_cycle_weeks}주 점검 주기가 지났습니다. 경고와 가설 상태를 보고 점검을 기록하세요.`,
        link: `/projects/${p.id}`,
        dedupeKey: `review:${p.id}:${week}`,
      });
      notified++;
    }
    const warnings = (await projectWarnings(admin, p.id, now)).filter((w) => w.kind === "proposal_overdue" || w.kind === "decision_pending");
    if (warnings.length) {
      await notifyProject(admin, p.id, {
        kind: "plan_mismatch",
        title: `확인할 것 ${warnings.length}건: ${p.name}`,
        body: warnings.map((w) => `- ${w.message}`).join("\n"),
        link: `/projects/${p.id}`,
        dedupeKey: `warn:${p.id}:${week}`,
      });
      notified++;
    }
  }

  const purge = await purgeExpiredRawFiles(admin, now);
  await admin.from("rate_limits").delete().lt("window_start", new Date(now.getTime() - 86_400_000).toISOString());
  return { sync, notified, purge, ms: Date.now() - started };
}
