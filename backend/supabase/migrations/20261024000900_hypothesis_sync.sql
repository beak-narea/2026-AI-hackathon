-- 1) 진단 대체 위험 항목: 자료에서 찾은 것(evidence_note)과 부족한 것·확인 방법(gap)을 나눠 둔다
alter table public.wrapper_items add column if not exists gap text not null default '';
-- 예전 초안의 "근거\n확인 방법: …" 한 칸을 둘로 나누고, "자료에 없음"은 빈 칸으로 둔다
update public.wrapper_items
   set gap = split_part(evidence_note, E'\n확인 방법: ', 2),
       evidence_note = case when split_part(evidence_note, E'\n확인 방법: ', 1) ~ '^\s*자료에 없음' then '' else split_part(evidence_note, E'\n확인 방법: ', 1) end
 where evidence_note like E'%\n확인 방법: %' and gap = '';

-- 2) 사업 모델 칸에서 나온 가설: 어느 칸에서 왔는지와 자료 점검 단계(충분함·부족함·없음)를 둔다
alter table public.hypotheses add column if not exists source_field text;
alter table public.hypotheses add column if not exists material_check text;
alter table public.hypotheses drop constraint if exists hypotheses_material_check_values;
alter table public.hypotheses add constraint hypotheses_material_check_values
  check (material_check is null or material_check in ('enough', 'weak', 'missing'));
create unique index if not exists hypotheses_source_field_once on public.hypotheses (project_id, source_field) where source_field is not null;

create or replace function public.schema_version() returns text
language sql immutable as $$ select '20261024000900'::text $$;
revoke execute on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;
