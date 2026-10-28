import { describe, expect, it } from "vitest";
import { asUser, freshDb } from "./migrate";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const db = await freshDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${U1}', 'a@example.com'), ('${U2}', 'b@example.com');
  `);
  await asUser(db, U1);
  const p = await db.query<{ id: string }>(
    `insert into public.projects (owner_id, name) values ('${U1}', '테스트') returning id`,
  );
  const projectId = p.rows[0]!.id;
  await db.exec("reset role");
  const h = await db.query<{ id: string }>(
    `insert into public.hypotheses (project_id, statement, type) values ('${projectId}', '가설', 'demand') returning id`,
  );
  return { db, projectId, hypothesisId: h.rows[0]!.id };
}

async function insertProposal(db: Awaited<ReturnType<typeof freshDb>>, projectId: string, hypothesisId: string, extra = "") {
  const r = await db.query<{ id: string; look_number: number }>(
    `insert into public.proposals (project_id, hypothesis_id, method_key, method, evidence_level_expected,
       target_value, min_value ${extra ? ", " + extra.split("=")[0] : ""})
     values ('${projectId}', '${hypothesisId}', 'fake_door', '가짜 버튼', 'L2', 0.6, 0.4 ${extra ? ", " + extra.split("=")[1] : ""})
     returning id, look_number`,
  );
  return r.rows[0]!;
}

describe("마이그레이션", () => {
  it("빈 DB에 오류 없이 적용되고 시드가 들어간다", async () => {
    const db = await freshDb({ seed: true });
    const r = await db.query<{ n: number }>("select count(*)::int as n from public.projects where is_example");
    expect(r.rows[0]!.n).toBe(1);
  });

  it("프로젝트를 만들면 만든 사람이 owner 멤버가 된다", async () => {
    const { db, projectId } = await setup();
    const r = await db.query<{ role: string }>(`select role from public.project_members where project_id = '${projectId}'`);
    expect(r.rows.map((x) => x.role)).toEqual(["owner"]);
  });
});

describe("잠금과 재판정 사슬", () => {
  it("잠근 목표값은 바꿀 수 없다", async () => {
    const { db, projectId, hypothesisId } = await setup();
    const p = await insertProposal(db, projectId, hypothesisId, "locked_at=now()");
    await expect(db.exec(`update public.proposals set target_value = 0.5 where id = '${p.id}'`)).rejects.toThrow(/잠근/);
    await db.exec(`update public.proposals set script = '수정 가능' where id = '${p.id}'`);
  });

  it("잠그기 전에는 결과를 낼 수 없다", async () => {
    const { db, projectId, hypothesisId } = await setup();
    const p = await insertProposal(db, projectId, hypothesisId);
    await expect(
      db.exec(`insert into public.evidence (project_id, proposal_id, method_same, recruitment, attempts, responses, successes, evidence_level)
               values ('${projectId}', '${p.id}', true, '직접 연락', 10, 10, 5, 'L2')`),
    ).rejects.toThrow(/잠근 뒤/);
  });

  it("재판정은 기준을 물려받고 최대 4회", async () => {
    const { db, projectId, hypothesisId } = await setup();
    const root = await insertProposal(db, projectId, hypothesisId, "locked_at=now()");
    for (let look = 2; look <= 4; look++) {
      const child = await db.query<{ look_number: number; target_value: string }>(
        `insert into public.proposals (project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, target_value, min_value)
         values ('${projectId}', '${hypothesisId}', '${root.id}', 'fake_door', '가짜 버튼', 'L2', 0.9, 0.1) returning look_number, target_value`,
      );
      expect(child.rows[0]!.look_number).toBe(look);
      expect(Number(child.rows[0]!.target_value)).toBe(0.6);
    }
    await expect(
      db.exec(`insert into public.proposals (project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, target_value, min_value)
               values ('${projectId}', '${hypothesisId}', '${root.id}', 'fake_door', '가짜 버튼', 'L2', 0.6, 0.4)`),
    ).rejects.toThrow(/최대 4회/);
  });
});

describe("RLS", () => {
  it("다른 사용자는 남의 프로젝트를 못 보고 예시는 본다", async () => {
    const { db, projectId } = await setup();
    await db.exec(`reset role`);
    await db.exec(await import("node:fs").then((fs) => fs.readFileSync("supabase/seed.sql", "utf8")));
    await asUser(db, U2);
    const r = await db.query<{ id: string; is_example: boolean }>("select id, is_example from public.projects");
    expect(r.rows.some((x) => x.id === projectId)).toBe(false);
    expect(r.rows.some((x) => x.is_example)).toBe(true);
  });

  it("사용자는 가설 상태를 직접 바꿀 수 없다", async () => {
    const { db, hypothesisId } = await setup();
    await asUser(db, U1);
    await expect(db.exec(`update public.hypotheses set status = 'met' where id = '${hypothesisId}'`)).rejects.toThrow(
      /permission denied/,
    );
    await db.exec(`update public.hypotheses set statement = '고친 문장' where id = '${hypothesisId}'`);
  });

  it("사용자는 판정을 직접 넣을 수 없다", async () => {
    const { db, projectId, hypothesisId } = await setup();
    const p = await insertProposal(db, projectId, hypothesisId, "locked_at=now()");
    await asUser(db, U1);
    await expect(
      db.exec(`insert into public.verdicts (project_id, hypothesis_id, proposal_id, root_proposal_id, evidence_ids, look_number,
                 n, successes, raw_n, target_value, min_value, p_above_target, p_below_min, wilson_low, wilson_high, result, evidence_level)
               values ('${projectId}', '${hypothesisId}', '${p.id}', '${p.id}', '{}', 1, 10, 9, 10, 0.6, 0.4, 0.9, 0.01, 0.6, 0.98, 'met', 'L2')`),
    ).rejects.toThrow(/row-level security|permission/);
  });

  it("예시 프로젝트는 아무도 고칠 수 없다", async () => {
    const db = await freshDb({ seed: true });
    await db.exec(`insert into auth.users (id, email) values ('${U1}', 'a@example.com')`);
    await asUser(db, U1);
    const r = await db.query(`update public.projects set name = '바꿈' where is_example returning id`);
    expect(r.rows.length).toBe(0);
  });
});

describe("바깥 관점", () => {
  it("10개 고객사 미만이면 아무것도 돌려주지 않는다", async () => {
    const db = await freshDb({ seed: true });
    const r = await db.query("select * from public.outside_view('demand')");
    expect(r.rows.length).toBe(0);
  });
});

describe("확장 테이블 RLS", () => {
  it("알림은 본인 것만 보이고 읽음 표시만 바꿀 수 있다", async () => {
    const { db } = await setup();
    await db.exec(`insert into public.notifications (user_id, kind, title) values ('${U1}', 'x', '내 알림'), ('${U2}', 'x', '남의 알림')`);
    await asUser(db, U1);
    const r = await db.query<{ title: string }>("select title from public.notifications");
    expect(r.rows.map((x) => x.title)).toEqual(["내 알림"]);
    await db.exec(`update public.notifications set read_at = now()`);
    await expect(db.exec(`update public.notifications set title = '바꿈'`)).rejects.toThrow(/permission denied/);
  });

  it("운영자 테이블·요청 제한·연동 비밀값은 사용자에게 보이지 않는다", async () => {
    const { db } = await setup();
    await db.exec(`insert into public.cohorts (name) values ('1기'); insert into public.mentors (name, email) values ('멘토', 'm@x.com')`);
    await asUser(db, U1);
    for (const t of ["cohorts", "mentors", "price_responses", "eval_runs", "grader_labels", "events", "rate_limits", "service_settings"]) {
      const r = await db.query(`select * from public.${t}`);
      expect(r.rows, t).toHaveLength(0);
    }
    await expect(db.query(`select public.consume_rate_limit('k', 1, 60)`)).rejects.toThrow(/permission denied/);
  });

  it("원자료 목록은 프로젝트 팀원만 본다", async () => {
    const { db, projectId } = await setup();
    await db.exec(`insert into public.raw_files (project_id, path, name, kind) values ('${projectId}', '${projectId}/a.csv', 'a.csv', 'csv')`);
    await asUser(db, U2);
    expect((await db.query("select * from public.raw_files")).rows).toHaveLength(0);
    await asUser(db, U1);
    expect((await db.query("select * from public.raw_files")).rows).toHaveLength(1);
  });
});
