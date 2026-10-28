// 매일 도는 예약 작업. 서버 함수 시간 제한(300초) 안에서 빠른 일부터 하고, 연동 가져오기는 남은 시간만큼 한다.
import "server-only";
import type { Db } from "../supabase/server";
import { syncAll } from "./sync";
import { purgeExpiredRawFiles } from "./rawFiles";
import { cycleOf, projectWarnings } from "./review";
import { notifyProject } from "./notifications";
import { selectAll } from "../supabase/paging";

type Project = { id: string; name: string; review_cycle_weeks: number; last_reviewed_at: string | null; created_at: string };

export async function runDaily(admin: Db, now = new Date(), budgetMs = 270_000) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const step = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      console.error(`[cron] ${name}`, (e as Error).message);
      return { error: (e as Error).message };
    }
  };

  // 1. 보관 기간이 지난 원자료 정리 (약속이므로 먼저)
  const purge = await step("purge", () => purgeExpiredRawFiles(admin, now, Math.min(deadline, Date.now() + 60_000)));

  // 2. 점검 주기·기한 알림 (같은 주에는 한 번만)
  // 1970-01-01부터 센 주 번호 (월요일 시작). 연도를 붙이지 않아 해가 바뀌는 주에도 키가 하나다
  const week = `w${Math.floor((now.getTime() / 86_400_000 + 3) / 7)}`;
  let notified = 0;
  let skippedProjects = 0;
  await step("notify", async () => {
    const projects = await selectAll<Project>((f, t) =>
      admin.from("projects").select("id, name, review_cycle_weeks, last_reviewed_at, created_at").eq("is_example", false).eq("status", "active").order("id").range(f, t),
    );
    const notifyDeadline = Math.min(deadline - 120_000, Date.now() + 120_000);
    for (const p of projects) {
      if (Date.now() > notifyDeadline) {
        skippedProjects++;
        continue;
      }
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
  });

  // 3. 오래된 요청 제한 기록 정리
  await step("rate_limits", async () => {
    await admin.from("rate_limits").delete().lt("window_start", new Date(now.getTime() - 86_400_000).toISOString());
  });

  // 4. 연동 가져오기·재판정: 남은 시간만큼. 못 한 연결은 다음 실행에서 먼저 한다
  const sync = await step("sync", () => syncAll(admin, deadline - 10_000));

  return { purge, notified, skipped_projects: skippedProjects, sync, ms: Date.now() - started };
}
