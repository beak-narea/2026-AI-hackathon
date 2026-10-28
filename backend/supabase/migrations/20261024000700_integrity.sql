-- 2차 검토 반영: 동시 요청·중복 계정·앞으로 만들 함수의 권한

-- ── 1. 앞으로 만드는 함수도 브라우저 역할이 부를 수 없다 ─────────────
-- (기본값은 PUBLIC에 실행 권한을 준다. 함수마다 revoke를 잊어도 PostgREST로 노출되지 않게)
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;

-- ── 2. 재판정: 앞 회차 판정이 나온 뒤에만 다음 회차를 만든다 ──────────
-- 동시에 두 번 눌러도 두 번째 요청은 앞 요청이 만든 (아직 판정 없는) 회차를 보고 거절된다.
create or replace function public.proposals_before_insert() returns trigger
language plpgsql as $$
declare
  root public.proposals;
  last_id uuid;
  last_look integer;
begin
  if new.root_proposal_id is not null then
    -- 처음 제안 행을 잠가 같은 사슬의 재판정 제안을 한 번에 하나씩 만든다
    select * into root from public.proposals where id = new.root_proposal_id for no key update;
    if root.id is null then
      raise exception 'root proposal not found';
    end if;
    if root.root_proposal_id is not null then
      raise exception 'root_proposal_id must point to the first proposal of the chain';
    end if;
    select p.id, p.look_number into last_id, last_look
      from public.proposals p
     where p.id = root.id or p.root_proposal_id = root.id
     order by p.look_number desc
     limit 1;
    if last_look >= 4 then
      raise exception '재판정은 처음 판정을 포함해 최대 4회다' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.verdicts v where v.proposal_id = last_id) then
      raise exception '앞 회차(%회차) 판정이 아직 없다. 결과를 내고 판정을 받은 뒤 재판정한다', last_look
        using errcode = 'unique_violation';
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

-- ── 3. 한 사람은 한 프로젝트에 한 번만 (메일을 바꾼 뒤 다시 초대돼도) ──
-- 같은 계정이 두 줄이면 권한 조회가 실패해 팀원이 잠긴다. 중복은 가장 강한 역할 한 줄만 남긴다.
delete from public.project_members
 where id in (
   select id from (
     select id, row_number() over (
              partition by project_id, user_id
              order by case role when 'owner' then 0 when 'member' then 1 else 2 end, invited_at, id) as rn
       from public.project_members where user_id is not null) x
    where x.rn > 1);
create unique index if not exists project_members_user_once on public.project_members (project_id, user_id) where user_id is not null;

-- 초대를 계정에 연결할 때 이미 그 프로젝트에 있는 사람이면 건너뛴다 (가입·인증이 실패하지 않게)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  if new.email_confirmed_at is not null then
    update public.project_members pm set user_id = new.id, joined_at = now()
     where lower(pm.email) = lower(new.email) and pm.user_id is null
       and not exists (select 1 from public.project_members o where o.project_id = pm.project_id and o.user_id = new.id);
  end if;
  return new;
end $$;

create or replace function public.link_invites_on_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.project_members pm set user_id = new.id, joined_at = now()
   where lower(pm.email) = lower(new.email) and pm.user_id is null
     and not exists (select 1 from public.project_members o where o.project_id = pm.project_id and o.user_id = new.id);
  return new;
end $$;

-- 예전 규칙(인증 전 연결)으로 이어진 초대는 연결을 푼다. 인증하면 다시 이어진다.
update public.project_members pm set user_id = null, joined_at = null
  from auth.users u
 where pm.user_id = u.id and pm.role <> 'owner' and u.email_confirmed_at is null;

-- ── 4. 스키마 버전 (npm run doctor가 최신 마이그레이션이 들어갔는지 본다) ──
create or replace function public.schema_version() returns text
language sql immutable as $$ select '20261024000700'::text $$;
revoke execute on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
