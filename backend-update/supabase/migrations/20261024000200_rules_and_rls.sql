-- 규칙 트리거와 행 단위 보안(RLS)
-- 원칙: 계산 결과(판정, 증거 수준, 가설 상태)는 서버 코드(service role)만 쓴다.
--       목표값·최소 허용치는 잠근 뒤 바꿀 수 없다.

-- ── 공통: updated_at ────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger projects_touch   before update on public.projects   for each row execute function public.touch_updated_at();
create trigger diagnoses_touch  before update on public.diagnoses  for each row execute function public.touch_updated_at();
create trigger hypotheses_touch before update on public.hypotheses for each row execute function public.touch_updated_at();
create trigger proposals_touch  before update on public.proposals  for each row execute function public.touch_updated_at();

-- ── 검증 제안: 잠금과 재판정 사슬 ───────────────────────────────────
create or replace function public.proposals_before_insert() returns trigger
language plpgsql as $$
declare
  root public.proposals;
  last_look integer;
begin
  if new.root_proposal_id is not null then
    select * into root from public.proposals where id = new.root_proposal_id;
    if root.id is null then
      raise exception 'root proposal not found';
    end if;
    if root.root_proposal_id is not null then
      raise exception 'root_proposal_id must point to the first proposal of the chain';
    end if;
    select max(look_number) into last_look
      from public.proposals where id = root.id or root_proposal_id = root.id;
    if last_look >= 4 then
      raise exception '재판정은 처음 판정을 포함해 최대 4회다' using errcode = 'check_violation';
    end if;
    -- 처음 잠근 목표값·최소 허용치를 그대로 쓴다
    new.hypothesis_id := root.hypothesis_id;
    new.project_id := root.project_id;
    new.target_value := root.target_value;
    new.min_value := root.min_value;
    new.look_number := last_look + 1;
    new.locked_at := coalesce(root.locked_at, now());
  end if;
  return new;
end $$;

create trigger proposals_chain before insert on public.proposals
  for each row execute function public.proposals_before_insert();

create or replace function public.proposals_guard_lock() returns trigger
language plpgsql as $$
begin
  if old.locked_at is not null then
    if new.target_value is distinct from old.target_value
       or new.min_value is distinct from old.min_value
       or new.locked_at is distinct from old.locked_at
       or new.hypothesis_id is distinct from old.hypothesis_id
       or new.root_proposal_id is distinct from old.root_proposal_id
       or new.look_number is distinct from old.look_number then
      raise exception '잠근 목표값·최소 허용치는 바꿀 수 없다. 새 검증 제안을 만든다.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger proposals_lock before update on public.proposals
  for each row execute function public.proposals_guard_lock();

-- 결과는 기준을 잠근 제안에만 낼 수 있다 (결과를 본 뒤 기준을 바꾸는 것을 막는다)
create or replace function public.evidence_require_locked() returns trigger
language plpgsql as $$
declare
  locked timestamptz;
  proj uuid;
begin
  select locked_at, project_id into locked, proj from public.proposals where id = new.proposal_id;
  if locked is null then
    raise exception '목표값·최소 허용치를 잠근 뒤에 결과를 낼 수 있다' using errcode = 'check_violation';
  end if;
  new.project_id := proj;
  return new;
end $$;

create trigger evidence_locked before insert on public.evidence
  for each row execute function public.evidence_require_locked();

-- 지표 카드: 잠근 뒤에는 기준을 바꿀 수 없다
create or replace function public.metric_cards_guard_lock() returns trigger
language plpgsql as $$
begin
  if old.locked_at is not null and (
       new.target_value is distinct from old.target_value
    or new.min_value is distinct from old.min_value
    or new.locked_at is distinct from old.locked_at
    or new.event_name is distinct from old.event_name
    or new.definition is distinct from old.definition) then
    raise exception '잠근 지표 카드의 정의와 기준은 바꿀 수 없다' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger metric_cards_lock before update on public.metric_cards
  for each row execute function public.metric_cards_guard_lock();

-- ── 권한 함수 ───────────────────────────────────────────────────────
create or replace function public.is_project_editor(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects where id = p and owner_id = auth.uid())
      or exists (select 1 from public.project_members
                  where project_id = p and user_id = auth.uid() and role in ('owner', 'member'));
$$;

create or replace function public.is_project_member(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_project_editor(p)
      or exists (select 1 from public.project_members where project_id = p and user_id = auth.uid());
$$;

create or replace function public.can_read_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_project_member(p)
      or exists (select 1 from public.projects where id = p and is_example);
$$;

-- 가입한 사용자의 프로필 자동 생성
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  -- 초대받은 이메일이면 멤버로 연결
  update public.project_members set user_id = new.id, joined_at = now()
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 프로젝트를 만들면 만든 사람을 owner 멤버로 넣는다
create or replace function public.projects_add_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.project_members (project_id, user_id, email, role, joined_at)
    select new.id, new.owner_id, coalesce(u.email, ''), 'owner', now() from auth.users u where u.id = new.owner_id
    on conflict (project_id, email) do nothing;
  end if;
  return new;
end $$;

create trigger projects_owner after insert on public.projects
  for each row execute function public.projects_add_owner();

-- ── 바깥 관점: 같은 유형 가설의 미달 비율 (비식별 집계, 10개 고객사 미만이면 숨김) ──
create or replace function public.outside_view(t public.hypothesis_type)
returns table (fail_rate numeric, judged integer, companies integer)
language sql stable security definer set search_path = public as $$
  with last_verdict as (
    select distinct on (v.hypothesis_id) v.hypothesis_id, v.result, p.owner_id
      from public.verdicts v
      join public.hypotheses h on h.id = v.hypothesis_id
      join public.projects p on p.id = v.project_id
     where h.type = t and not p.is_example and v.result in ('met', 'not_met')
     order by v.hypothesis_id, v.created_at desc
  )
  select round(avg((result = 'not_met')::int)::numeric, 3), count(*)::int, count(distinct owner_id)::int
    from last_verdict
  having count(distinct owner_id) >= 10;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_members     enable row level security;
alter table public.source_files        enable row level security;
alter table public.business_models     enable row level security;
alter table public.tasks               enable row level security;
alter table public.diagnoses           enable row level security;
alter table public.wrapper_items       enable row level security;
alter table public.baseline_tests      enable row level security;
alter table public.baseline_pairs      enable row level security;
alter table public.baseline_votes      enable row level security;
alter table public.price_table         enable row level security;
alter table public.cost_models         enable row level security;
alter table public.hypotheses          enable row level security;
alter table public.criticality_ratings enable row level security;
alter table public.proposals           enable row level security;
alter table public.evidence            enable row level security;
alter table public.transcripts         enable row level security;
alter table public.insights            enable row level security;
alter table public.verdicts            enable row level security;
alter table public.decisions           enable row level security;
alter table public.metric_cards        enable row level security;
alter table public.data_connections    enable row level security;
alter table public.llm_calls           enable row level security;
alter table public.workbank_tasks      enable row level security;
alter table public.metric_observations enable row level security;
alter table public.cost_observations   enable row level security;
-- 정책 없음: anon·authenticated는 접근 불가, service role만
alter table public.pseudonym_keys      enable row level security;
alter table public.connection_secrets  enable row level security;
revoke all on public.pseudonym_keys from anon, authenticated;
revoke all on public.connection_secrets from anon, authenticated;

create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy projects_read on public.projects for select to anon, authenticated
  using (is_example or owner_id = auth.uid() or public.is_project_member(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (owner_id = auth.uid() and not is_example);
create policy projects_update on public.projects for update to authenticated
  using (public.is_project_editor(id) and not is_example) with check (not is_example);

create policy members_read on public.project_members for select to authenticated
  using (public.is_project_member(project_id));
create policy members_write on public.project_members for all to authenticated
  using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));

-- 프로젝트 소속 테이블: 읽기 = 멤버 또는 예시, 쓰기 = 편집자 (예시 프로젝트는 읽기 전용)
do $$
declare
  t text;
begin
  foreach t in array array[
    'source_files', 'business_models', 'tasks', 'diagnoses', 'wrapper_items',
    'baseline_tests', 'cost_models', 'transcripts', 'insights', 'metric_cards', 'data_connections'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select to anon, authenticated
        using (public.can_read_project(project_id));
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check (public.is_project_editor(project_id));
      create policy %1$s_update on public.%1$I for update to authenticated
        using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
      create policy %1$s_delete on public.%1$I for delete to authenticated
        using (public.is_project_editor(project_id));
    $f$, t);
  end loop;
end $$;

-- 서버 계산 결과: 읽기만 허용 (쓰기는 service role)
do $$
declare
  t text;
begin
  foreach t in array array['verdicts', 'decisions', 'evidence', 'baseline_pairs', 'baseline_votes',
                           'metric_observations', 'cost_observations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select to anon, authenticated
        using (public.can_read_project(project_id));
    $f$, t);
  end loop;
end $$;

-- 가설: 새로 만들 때는 미검증·L0로만 (상태와 증거 수준은 서버가 바꾼다)
create policy hypotheses_read on public.hypotheses for select to anon, authenticated
  using (public.can_read_project(project_id));
create policy hypotheses_insert on public.hypotheses for insert to authenticated
  with check (public.is_project_editor(project_id) and status = 'unverified' and evidence_level = 'L0');
create policy hypotheses_update on public.hypotheses for update to authenticated
  using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
create policy hypotheses_delete on public.hypotheses for delete to authenticated
  using (public.is_project_editor(project_id) and status = 'unverified');

-- 검증 제안: 만들기는 서버(표본 수·결정표 계산)만, 문구 수정은 편집자, 삭제는 초안만
create policy proposals_read on public.proposals for select to anon, authenticated
  using (public.can_read_project(project_id));
create policy proposals_update on public.proposals for update to authenticated
  using (public.is_project_editor(project_id)) with check (public.is_project_editor(project_id));
create policy proposals_delete on public.proposals for delete to authenticated
  using (public.is_project_editor(project_id) and locked_at is null);

-- 결과 제출(증거)은 API가 입력을 검증하고 증거 수준·유효 표본을 계산해 service role로 넣는다

-- 중요도 평정: 멤버(외부 평가자 포함)가 자기 평정만 쓴다
create policy ratings_read on public.criticality_ratings for select to anon, authenticated
  using (public.can_read_project(project_id));
create policy ratings_insert on public.criticality_ratings for insert to authenticated
  with check (public.is_project_member(project_id) and rater_user_id = auth.uid() and rater_type <> 'llm');
create policy ratings_update on public.criticality_ratings for update to authenticated
  using (rater_user_id = auth.uid()) with check (rater_user_id = auth.uid() and rater_type <> 'llm');

create policy price_table_read on public.price_table for select to anon, authenticated using (true);
create policy workbank_read on public.workbank_tasks for select to authenticated using (true);
create policy llm_calls_read on public.llm_calls for select to authenticated
  using (project_id is not null and public.is_project_member(project_id));

-- 가설의 상태·증거 수준은 결정·판정을 거쳐 서버만 바꾼다
revoke update on public.hypotheses from anon, authenticated;
grant update (statement, type, criticality, rank, premortem_reason, edited_by_user) on public.hypotheses to authenticated;

-- 검증 제안의 계산 필드(표본 수, 결정표, 결론 확률)는 서버만 바꾼다
revoke update on public.proposals from anon, authenticated;
grant update (method, guide_steps, prerequisites, mvp_scope, recruitment, script, operating_rules,
              expected_weeks, edited_by_user) on public.proposals to authenticated;

-- 증거 수준·유효 표본은 서버가 계산한다
revoke update on public.evidence from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant execute on function public.outside_view(public.hypothesis_type) to authenticated;

-- 초대할 때 가입한 사용자인지 찾는다 (service role 전용)
create or replace function public.user_id_by_email(e text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(e) limit 1;
$$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;

-- WORKBank 유사 업무 검색 (수요 축 사전값: 참고용, 판정에 쓰지 않는다)
create or replace function public.match_workbank(query_embedding extensions.vector(1024), match_count integer default 3)
returns table (id bigint, occupation text, task_statement text, automation_desire numeric, similarity double precision)
language sql stable set search_path = public, extensions as $$
  select w.id, w.occupation, w.task_statement, w.automation_desire, 1 - (w.embedding <=> query_embedding)
    from public.workbank_tasks w
   where w.embedding is not null
   order by w.embedding <=> query_embedding
   limit match_count;
$$;
create index workbank_tasks_embedding_idx on public.workbank_tasks using hnsw (embedding extensions.vector_cosine_ops);
