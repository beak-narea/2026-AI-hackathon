-- 보안·무결성 보강 (코드 검토 결과 반영)

-- ── 0. 예전 규칙에서 생길 수 있던 중복을 먼저 정리한다 (빈 DB면 아무 일도 없다) ──
-- 아래에서 만드는 고유 인덱스가 기존 중복 때문에 실패하지 않게 한다.
-- 같은 제안에 결과가 둘 이상이면 처음 낸 것만 남긴다 (나중 결과로 낸 판정도 함께 지운다)
delete from public.verdicts v where exists (
  select 1 from (select id, row_number() over (partition by proposal_id order by created_at, id) as rn from public.evidence) x
   where x.rn > 1 and x.id = any (v.evidence_ids));
delete from public.evidence where id in (
  select id from (select id, row_number() over (partition by proposal_id order by created_at, id) as rn from public.evidence) x where x.rn > 1);
-- 같은 메일로 두 번 초대된 줄은 계정에 연결된 것, 그다음 먼저 초대한 것을 남긴다
delete from public.project_members where id in (
  select id from (select id, row_number() over (partition by project_id, lower(email)
                    order by case role when 'owner' then 0 else 1 end, (user_id is null), invited_at, id) as rn
                    from public.project_members) x where x.rn > 1);
-- 같은 기간 비용은 마지막에 들어온 값만 남긴다
delete from public.cost_observations where id in (
  select id from (select id, row_number() over (partition by project_id, source, period_start order by created_at desc, id desc) as rn
                    from public.cost_observations) x where x.rn > 1);

-- ── 1. 브라우저는 DB에 직접 접근하지 않는다 ─────────────────────────
-- 모든 읽기·쓰기는 서버 API가 역할(소유자·팀원·외부 평가자·운영자)을 확인한 뒤 service role로 한다.
-- 공개 anon 키로 PostgREST를 직접 불러 RLS의 빈틈(소유권 탈취, 계산값 덮어쓰기, 블라인드 정답 열람)을 쓰는 길을 막는다.
-- RLS 정책은 그대로 두어 2차 방어선으로 쓴다.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- RPC로 부를 수 있는 함수는 서버만
revoke execute on function public.is_project_editor(uuid) from public, anon, authenticated;
revoke execute on function public.is_project_member(uuid) from public, anon, authenticated;
revoke execute on function public.can_read_project(uuid) from public, anon, authenticated;
revoke execute on function public.outside_view(public.hypothesis_type) from public, anon, authenticated;
revoke execute on function public.match_workbank(extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.is_project_editor(uuid) to service_role;
grant execute on function public.is_project_member(uuid) to service_role;
grant execute on function public.can_read_project(uuid) to service_role;
grant execute on function public.outside_view(public.hypothesis_type) to service_role;
grant execute on function public.match_workbank(extensions.vector, integer) to service_role;

-- ── 2. 요청 제한: 첫 요청이 동시에 와도 한 번에 센다 ────────────────
create or replace function public.consume_rate_limit(k text, lim integer, window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  c integer;
begin
  insert into public.rate_limits as r (key, window_start, count) values (k, now(), 1)
  on conflict (key) do update set
    count = case when r.window_start < now() - make_interval(secs => window_seconds) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => window_seconds) then now() else r.window_start end
  returning r.count into c;
  return c <= lim;
end $$;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- ── 3. 재판정 사슬: 동시에 만들어도 회차가 겹치지 않는다 ────────────
create or replace function public.proposals_before_insert() returns trigger
language plpgsql as $$
declare
  root public.proposals;
  last_look integer;
begin
  if new.root_proposal_id is not null then
    -- 처음 제안 행을 잠가 같은 사슬의 재판정 제안을 한 번에 하나씩 만든다
    select * into root from public.proposals where id = new.root_proposal_id for update;
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
    new.hypothesis_id := root.hypothesis_id;
    new.project_id := root.project_id;
    new.target_value := root.target_value;
    new.min_value := root.min_value;
    new.look_number := last_look + 1;
    new.locked_at := coalesce(root.locked_at, now());
  end if;
  return new;
end $$;
-- 예전 규칙에서 회차가 겹친 사슬이 있으면 (잠근 제안이라 회차를 고칠 수 없다) 인덱스 없이 넘어간다.
-- 그런 사슬도 20261024000700의 "앞 회차 판정이 나온 뒤에만" 규칙으로 더는 겹치지 않는다.
do $$
begin
  if exists (select 1 from public.proposals where root_proposal_id is not null
              group by root_proposal_id, look_number having count(*) > 1) then
    raise notice '재판정 회차가 겹친 사슬이 있어 proposals_chain_look 인덱스를 만들지 않았다';
  else
    create unique index proposals_chain_look on public.proposals (root_proposal_id, look_number) where root_proposal_id is not null;
  end if;
end $$;

-- 제안 하나에 결과는 하나 (동시 제출 방지)
create unique index evidence_one_per_proposal on public.evidence (proposal_id);

-- ── 4. 잠근 지표 카드는 가설·프로젝트도 바꿀 수 없다 ───────────────
create or replace function public.metric_cards_guard_lock() returns trigger
language plpgsql as $$
begin
  if old.locked_at is not null and (
       new.target_value is distinct from old.target_value
    or new.min_value is distinct from old.min_value
    or new.locked_at is distinct from old.locked_at
    or new.event_name is distinct from old.event_name
    or new.definition is distinct from old.definition
    or new.hypothesis_id is distinct from old.hypothesis_id
    or new.project_id is distinct from old.project_id) then
    raise exception '잠근 지표 카드의 정의와 기준은 바꿀 수 없다' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── 5. 초대: 이메일을 확인한 계정만 연결, 대소문자 구분 없이 한 번만 ──
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  if new.email_confirmed_at is not null then
    update public.project_members set user_id = new.id, joined_at = now()
     where lower(email) = lower(new.email) and user_id is null;
  end if;
  return new;
end $$;

create or replace function public.link_invites_on_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.project_members set user_id = new.id, joined_at = now()
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.link_invites_on_confirm();

create or replace function public.user_id_by_email(e text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(e) and email_confirmed_at is not null limit 1;
$$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

create unique index project_members_email_ci on public.project_members (project_id, lower(email));

-- ── 6. 집계는 DB에서 (응답 1000행 제한에 걸리지 않게) ──────────────
create or replace function public.llm_cost_since(p uuid, since timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_krw), 0) from public.llm_calls where project_id = p and created_at >= since;
$$;
revoke execute on function public.llm_cost_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.llm_cost_since(uuid, timestamptz) to service_role;

-- 보관 기간이 지난 원자료 (프로젝트마다 기간이 다르다)
create or replace function public.expired_raw_files(lim integer) returns table (id uuid, path text)
language sql stable security definer set search_path = public as $$
  select r.id, r.path
    from public.raw_files r join public.projects p on p.id = r.project_id
   where r.deleted_at is null and r.created_at < now() - make_interval(days => p.raw_retention_days)
   order by r.created_at
   limit lim;
$$;
revoke execute on function public.expired_raw_files(integer) from public, anon, authenticated;
grant execute on function public.expired_raw_files(integer) to service_role;

-- 같은 기간 비용을 두 번 넣지 않는다 (수동 가져오기와 예약 작업이 겹칠 때)
create unique index cost_observations_period on public.cost_observations (project_id, source, period_start);

-- ── 7. 자주 쓰는 조회와 삭제 연쇄용 인덱스 ─────────────────────────
create index if not exists evidence_project_idx on public.evidence (project_id);
create index if not exists verdicts_project_idx on public.verdicts (project_id, created_at);
create index if not exists verdicts_proposal_idx on public.verdicts (proposal_id);
create index if not exists decisions_project_idx on public.decisions (project_id);
create index if not exists decisions_hypothesis_idx on public.decisions (hypothesis_id);
create index if not exists proposals_project_idx on public.proposals (project_id);
create index if not exists ratings_project_idx on public.criticality_ratings (project_id);
create index if not exists metric_cards_project_idx on public.metric_cards (project_id);
create index if not exists metric_cards_hypothesis_idx on public.metric_cards (hypothesis_id);
create index if not exists metric_obs_card_idx on public.metric_observations (metric_card_id);
create index if not exists tasks_bm_idx on public.tasks (business_model_id);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists transcripts_project_idx on public.transcripts (project_id);
create index if not exists insights_transcript_idx on public.insights (transcript_id);
create index if not exists insights_project_idx on public.insights (project_id);
create index if not exists source_files_project_idx on public.source_files (project_id);
create index if not exists cost_models_project_idx on public.cost_models (project_id);
create index if not exists pitch_drafts_proposal_idx on public.pitch_drafts (proposal_id);
create index if not exists reviews_project_idx on public.reviews (project_id, created_at);
create index if not exists mentor_requests_project_idx on public.mentor_requests (project_id);
create index if not exists data_connections_project_idx on public.data_connections (project_id);
create index if not exists wrapper_items_project_idx on public.wrapper_items (project_id);
create index if not exists baseline_votes_pair_idx on public.baseline_votes (pair_id);
create index if not exists llm_calls_user_idx on public.llm_calls (user_id);
create index if not exists events_user_idx on public.events (user_id);
create index if not exists notifications_project_idx on public.notifications (project_id);
create index if not exists raw_files_alive_idx on public.raw_files (created_at) where deleted_at is null;

-- 멘토 요청 updated_at 자동 갱신
create trigger mentor_requests_touch before update on public.mentor_requests for each row execute function public.touch_updated_at();
