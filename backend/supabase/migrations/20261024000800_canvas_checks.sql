-- 사업 모델 칸마다 "이 칸이 전제하는 가설"과 자료 점검(충분함·부족함·없음)을 저장한다
alter table public.business_models add column if not exists checks jsonb not null default '[]'::jsonb;

create or replace function public.schema_version() returns text
language sql immutable as $$ select '20261024000800'::text $$;
revoke execute on function public.schema_version() from public, anon, authenticated;
grant execute on function public.schema_version() to service_role;

-- 이미 들어가 있는 예시 프로젝트에도 점검을 채운다 (setup은 예시 프로젝트를 다시 넣지 않는다)
update public.business_models set checks = '[{"field":"problem","hypothesis":"기장 담당 직원은 증빙 분류에 월 40시간 이상 쓴다","status":"enough","found":"월 40시간 이상, 성수기에는 야근으로 메운다는 구체적 서술","gap":""},{"field":"customer_segments","hypothesis":"직원 5~30명 세무사 사무실이 첫 고객이다","status":"enough","found":"규모와 실무자·구매자 구분이 있다","gap":""},{"field":"unique_value_proposition","hypothesis":"분류 초안을 검토만 하면 분류 시간이 절반 이하로 준다","status":"weak","found":"검토만 한다는 서술","gap":"검토 시간이 실제로 얼마나 주는지 측정이 없다"},{"field":"solution","hypothesis":"OCR과 분류 모델로 사람이 고칠 일이 적은 초안을 만들 수 있다","status":"weak","found":"구성 요소 목록","gap":"사무소 증빙으로 잰 분류 정확도가 없다"},{"field":"channels","hypothesis":"세무사회 지역 모임과 대리점 제휴로 사무소를 만날 수 있다","status":"weak","found":"채널 후보 두 가지","gap":"실제 연락·전환 기록이 없다"},{"field":"revenue_streams","hypothesis":"대표 세무사가 처리 건수 구간별 월 구독료를 낸다","status":"weak","found":"월 구독 방식","gap":"가격과 지불 의향 근거가 없다"},{"field":"cost_structure","hypothesis":"모델 호출·검수·영업 비용이 구독료 안에 들어온다","status":"weak","found":"비용 항목 목록","gap":"건당 비용과 손익분기 계산이 없다"},{"field":"key_metrics","hypothesis":"직원 1인당 분류 시간과 수정률로 효과를 잴 수 있다","status":"enough","found":"측정 단위가 정해져 있다","gap":""},{"field":"unfair_advantage","hypothesis":"사무소별 수정 이력이 쌓이면 범용 AI보다 정확해진다","status":"weak","found":"수정 이력 축적","gap":"이력이 정확도를 얼마나 올리는지 근거가 없다"}]'::jsonb
 where id = '00000000-0000-4000-8000-000000000010' and checks = '[]'::jsonb;
