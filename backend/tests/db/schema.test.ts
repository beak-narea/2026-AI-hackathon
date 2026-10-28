import { describe, expect, it } from "vitest";
import { asUser, freshDb } from "./migrate";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const db = await freshDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${U1}', 'a@example.com'), ('${U2}', 'b@example.com');
  `);
  // 서버(service role)가 만든다. 브라우저 역할은 DB에 직접 쓰지 못한다.
  const p = await db.query<{ id: string }>(
    `insert into public.projects (owner_id, name) values ('${U1}', '테스트') returning id`,
  );
  const projectId = p.rows[0]!.id;
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

async function addVerdict(db: Awaited<ReturnType<typeof freshDb>>, proposalId: string) {
  await db.exec(`insert into public.verdicts (project_id, hypothesis_id, proposal_id, root_proposal_id, evidence_ids, look_number, n, successes, raw_n,
      target_value, min_value, p_above_target, p_below_min, wilson_low, wilson_high, result, evidence_level)
    select project_id, hypothesis_id, id, coalesce(root_proposal_id, id), array[]::uuid[], look_number, 10, 5, 10, target_value, min_value,
      0.3, 0.3, 0.2, 0.8, 'on_hold', 'L2' from public.proposals where id = '${proposalId}'`);
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
    let last = root.id;
    for (let look = 2; look <= 4; look++) {
      await addVerdict(db, last);
      const child = await db.query<{ id: string; look_number: number; target_value: string }>(
        `insert into public.proposals (project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, target_value, min_value)
         values ('${projectId}', '${hypothesisId}', '${root.id}', 'fake_door', '가짜 버튼', 'L2', 0.9, 0.1) returning id, look_number, target_value`,
      );
      expect(child.rows[0]!.look_number).toBe(look);
      expect(Number(child.rows[0]!.target_value)).toBe(0.6);
      last = child.rows[0]!.id;
    }
    await addVerdict(db, last);
    await expect(
      db.exec(`insert into public.proposals (project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, target_value, min_value)
               values ('${projectId}', '${hypothesisId}', '${root.id}', 'fake_door', '가짜 버튼', 'L2', 0.6, 0.4)`),
    ).rejects.toThrow(/최대 4회/);
  });
});

describe("브라우저 역할의 직접 접근 차단", () => {
  it("anon·authenticated는 어떤 테이블도 읽거나 쓰지 못한다 (모든 접근은 서버 API를 거친다)", async () => {
    const { db, projectId } = await setup();
    const tables = (await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
    expect(tables.length).toBeGreaterThan(30);
    for (const role of ["anon", "authenticated"]) {
      await asUser(db, role === "anon" ? null : U1, role);
      for (const t of tables) {
        await expect(db.query(`select 1 from public.${t} limit 1`), `${role} select ${t}`).rejects.toThrow(/permission denied/);
      }
      await expect(db.exec(`update public.projects set owner_id = '${U2}' where id = '${projectId}'`)).rejects.toThrow(/permission denied/);
      await expect(db.exec(`update public.project_members set role = 'owner'`)).rejects.toThrow(/permission denied/);
      await expect(db.exec(`update public.diagnoses set zone = 'green'`)).rejects.toThrow(/permission denied/);
    }
    await db.exec("reset role");
  });

  it("서버 전용 함수는 브라우저 역할이 부를 수 없다", async () => {
    const { db } = await setup();
    await asUser(db, U1);
    for (const sql of [
      `select public.consume_rate_limit('k', 1, 60)`,
      `select public.user_id_by_email('a@example.com')`,
      `select * from public.outside_view('demand')`,
      `select public.is_project_editor(gen_random_uuid())`,
      `select public.llm_cost_since(gen_random_uuid(), now())`,
      `select * from public.expired_raw_files(10)`,
    ]) {
      await expect(db.query(sql), sql).rejects.toThrow(/permission denied/);
    }
    await db.exec("reset role");
  });
});

describe("바깥 관점", () => {
  it("10개 고객사 미만이면 아무것도 돌려주지 않는다", async () => {
    const db = await freshDb({ seed: true });
    const r = await db.query("select * from public.outside_view('demand')");
    expect(r.rows.length).toBe(0);
  });
});

describe("확장 규칙", () => {
  it("요청 제한: 창 안에서는 한도까지만, 창이 지나면 다시 센다", async () => {
    const db = await freshDb();
    const hit = async () => (await db.query<{ ok: boolean }>(`select public.consume_rate_limit('k', 2, 60) as ok`)).rows[0]!.ok;
    expect([await hit(), await hit(), await hit()]).toEqual([true, true, false]);
    await db.exec(`update public.rate_limits set window_start = now() - interval '2 minutes'`);
    expect(await hit()).toBe(true);
  });

  it("재판정은 앞 회차 판정이 나온 뒤에만 (동시에 두 번 눌러도 한 회차), 제안 하나에 결과는 하나", async () => {
    const { db, projectId, hypothesisId } = await setup();
    const root = await insertProposal(db, projectId, hypothesisId, "locked_at=now()");
    const child = `insert into public.proposals (project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, target_value, min_value)
       values ('${projectId}', '${hypothesisId}', '${root.id}', 'fake_door', '가짜 버튼', 'L2', 0.6, 0.4) returning id`;
    await expect(db.exec(child)).rejects.toThrow(/판정이 아직 없다/);
    await addVerdict(db, root.id);
    await db.exec(child);
    await expect(db.exec(child)).rejects.toThrow(/2회차\) 판정이 아직 없다/);
    const looks = await db.query<{ look_number: number }>(`select look_number from public.proposals where root_proposal_id = '${root.id}' order by look_number`);
    expect(looks.rows.map((r) => r.look_number)).toEqual([2]);
    const idx = await db.query(`select 1 from pg_indexes where indexname = 'proposals_chain_look'`);
    expect(idx.rows).toHaveLength(1);
    const ev = `insert into public.evidence (project_id, proposal_id, method_same, recruitment, attempts, responses, successes, evidence_level)
                values ('${projectId}', '${root.id}', true, '직접 연락', 10, 10, 5, 'L2')`;
    await db.exec(ev);
    await expect(db.exec(ev)).rejects.toThrow(/duplicate|unique/);
  });

  it("한 계정은 한 프로젝트에 한 줄만, 이미 팀원이면 다른 메일 초대는 연결하지 않는다", async () => {
    const { db, projectId } = await setup();
    // U1(소유자)이 메일을 바꾼 뒤 새 메일로 다시 초대된 경우
    await db.exec(`insert into public.project_members (project_id, email, role) values ('${projectId}', 'a-new@example.com', 'member')`);
    await db.exec(`update auth.users set email = 'a-new@example.com', email_confirmed_at = null where id = '${U1}'`);
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${U1}'`); // 인증 → 연결 시도
    const rows = await db.query<{ role: string }>(`select role from public.project_members where project_id = '${projectId}' and user_id = '${U1}'`);
    expect(rows.rows.map((r) => r.role)).toEqual(["owner"]);
    await expect(db.exec(`update public.project_members set user_id = '${U1}' where email = 'a-new@example.com'`)).rejects.toThrow(/duplicate|unique/);
  });

  it("앞으로 만드는 함수도 브라우저 역할은 부를 수 없다", async () => {
    const db = await freshDb();
    await db.exec(`create function public.zz_new() returns int language sql as $$ select 1 $$`);
    await asUser(db, U1);
    await expect(db.query(`select public.zz_new()`)).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  });

  it("실사용 지표의 측정 이벤트는 기준과 함께 잠긴다", async () => {
    const { db, projectId, hypothesisId } = await setup();
    const src = `'{"numerator_event":"ai_feature_used","denominator_event":"ai_feature_viewed","window_days":14}'::jsonb`;
    await expect(db.exec(`insert into public.proposals (project_id, hypothesis_id, method_key, method, evidence_level_expected, target_value, min_value, metric_source)
       values ('${projectId}', '${hypothesisId}', 'usage_metric', '실사용 지표', 'L3', 0.4, 0.2, '{"numerator_event":"","denominator_event":"x","window_days":14}'::jsonb)`)).rejects.toThrow(/metric_source/);
    const p = (await db.query<{ id: string }>(
      `insert into public.proposals (project_id, hypothesis_id, method_key, method, evidence_level_expected, target_value, min_value, metric_source)
       values ('${projectId}', '${hypothesisId}', 'usage_metric', '실사용 지표', 'L3', 0.4, 0.2, ${src}) returning id`,
    )).rows[0]!.id;
    await db.exec(`update public.proposals set metric_source = jsonb_set(metric_source, '{window_days}', '7') where id = '${p}'`);
    await db.exec(`update public.proposals set locked_at = now() where id = '${p}'`);
    await expect(db.exec(`update public.proposals set metric_source = jsonb_set(metric_source, '{window_days}', '30') where id = '${p}'`)).rejects.toThrow(/잠근/);
  });

  it("출시 후 지표 카드 테이블은 없다", async () => {
    const { db } = await setup();
    const r = await db.query<{ t: string | null }>(`select to_regclass('public.metric_cards')::text as t`);
    expect(r.rows[0]!.t).toBeNull();
  });

  it("초대는 이메일을 확인한 계정에만 연결되고, 대소문자가 달라도 한 번만 초대된다", async () => {
    const { db, projectId } = await setup();
    await db.exec(`insert into public.project_members (project_id, email, role) values ('${projectId}', 'new@example.com', 'member')`);
    await expect(db.exec(`insert into public.project_members (project_id, email, role) values ('${projectId}', 'NEW@example.com', 'member')`)).rejects.toThrow(/duplicate|unique/);
    const U3 = "33333333-3333-4333-8333-333333333333";
    await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${U3}', 'new@example.com', null)`);
    const before = await db.query<{ user_id: string | null }>(`select user_id from public.project_members where email = 'new@example.com'`);
    expect(before.rows[0]!.user_id).toBeNull();
    expect((await db.query<{ v: string | null }>(`select public.user_id_by_email('new@example.com') as v`)).rows[0]!.v).toBeNull();
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${U3}'`);
    const after = await db.query<{ user_id: string | null }>(`select user_id from public.project_members where email = 'new@example.com'`);
    expect(after.rows[0]!.user_id).toBe(U3);
  });

  it("집계 함수: 월 AI 비용 합계와 보관 기간이 지난 원자료", async () => {
    const { db, projectId } = await setup();
    await db.exec(`insert into public.llm_calls (project_id, purpose, prompt_version, model, cost_krw, ok)
                   select '${projectId}', 'x', 'x', 'x', 10, true from generate_series(1, 1500)`);
    const sum = await db.query<{ v: string }>(`select public.llm_cost_since('${projectId}', now() - interval '1 day') as v`);
    expect(Number(sum.rows[0]!.v)).toBe(15000);
    await db.exec(`insert into public.raw_files (project_id, path, name, kind, created_at) values
      ('${projectId}', '${projectId}/old.csv', 'old.csv', 'csv', now() - interval '400 days'),
      ('${projectId}', '${projectId}/new.csv', 'new.csv', 'csv', now())`);
    const exp = await db.query<{ path: string }>(`select path from public.expired_raw_files(10)`);
    expect(exp.rows.map((r) => r.path)).toEqual([`${projectId}/old.csv`]);
  });
});
