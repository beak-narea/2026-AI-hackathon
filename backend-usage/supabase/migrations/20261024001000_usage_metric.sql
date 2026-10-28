-- 출시 후 측정을 따로 두지 않고 검증 흐름 하나로 합친다.
-- 실사용 지표는 검증 기획서의 실험 방법 가운데 하나다: 분자·분모 이벤트와 측정 기간을 기준과 함께 잠그고,
-- 측정 기간이 끝나면 연결한 분석 도구(또는 직접 집계)의 값이 결과로 들어와 같은 판정 규칙으로 판정한다.

-- 1) 기획서에 측정 이벤트
alter table public.proposals add column if not exists metric_source jsonb;
alter table public.proposals drop constraint if exists proposals_metric_source_shape;
alter table public.proposals add constraint proposals_metric_source_shape check (
  metric_source is null or (
    jsonb_typeof(metric_source) = 'object'
    and coalesce(metric_source->>'numerator_event', '') <> ''
    and coalesce(metric_source->>'denominator_event', '') <> ''
    and (metric_source->>'window_days') ~ '^[0-9]+$'
    and (metric_source->>'window_days')::int between 1 and 90
  )
);

-- 2) 잠근 뒤에는 측정 이벤트도 바꿀 수 없다 (결과를 보고 정의를 바꾸지 않게)
create or replace function public.proposals_guard_lock() returns trigger
language plpgsql as $$
begin
  if old.locked_at is not null then
    if new.target_value is distinct from old.target_value
       or new.min_value is distinct from old.min_value
       or new.locked_at is distinct from old.locked_at
       or new.hypothesis_id is distinct from old.hypothesis_id
       or new.root_proposal_id is distinct from old.root_proposal_id
       or new.look_number is distinct from old.look_number
       or new.metric_source is distinct from old.metric_source then
      raise exception '잠근 목표값·최소 허용치와 측정 이벤트는 바꿀 수 없다. 새 검증 제안을 만든다.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- 3) 따로 있던 출시 후 지표 카드와 관측값은 지운다
drop table if exists public.metric_observations;
drop table if exists public.metric_cards;
drop function if exists public.metric_cards_guard_lock();

create or replace function public.schema_version() returns text
language sql immutable as $$ select '20261024001000'::text $$;
revoke execute on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
