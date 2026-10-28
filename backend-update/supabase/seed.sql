-- 예시 프로젝트 (가상 사례). scripts/generate-seed.ts로 생성 — 직접 고치지 말 것
begin;
delete from public.projects where id = '00000000-0000-4000-8000-000000000001';
insert into public.projects (id, owner_id, name, idea_text, is_example, is_b2b) values ('00000000-0000-4000-8000-000000000001', null,
  '예시 · 세무 증빙 자동 분류 AI',
  '세무사 사무실 직원이 매달 수천 장씩 손으로 나누는 영수증·세금계산서를 AI가 계정과목별로 분류해 주는 서비스. 사무소의 기존 세무 프로그램으로 결과를 바로 보낸다.',
  true, true);
insert into public.business_models (id, project_id, version, problem, customer_segments, unique_value_proposition, solution,
  channels, revenue_streams, cost_structure, key_metrics, unfair_advantage, extracted_by_llm, edited_by_user) values ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 1,
  '기장 대행 사무소 직원이 증빙 분류에 월 40시간 이상을 쓴다. 성수기에는 야근으로 메운다.',
  '직원 5~30명 규모의 세무사 사무실 (실무자: 기장 담당 직원, 구매자: 대표 세무사)',
  '증빙을 올리면 계정과목 분류 초안이 나오고, 직원은 검토만 한다',
  '증빙 OCR + 분류 모델 + 사무소별 분류 이력 학습 + 세무 프로그램 내보내기',
  '세무사회 지역 모임, 세무 프로그램 판매 대리점 제휴',
  '사무소당 월 구독 (처리 건수 구간별)',
  '모델 호출 비용, 검수 인력, 영업',
  '직원 1인당 월 분류 시간, 분류 수정률',
  '사무소별로 쌓이는 분류 수정 이력',
  true, true);
insert into public.tasks (id, project_id, business_model_id, name, role, position) values ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '영수증·세금계산서를 계정과목별로 분류', 'practitioner', 0);
insert into public.tasks (id, project_id, business_model_id, name, role, position) values ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '분류 결과 검토·수정', 'practitioner', 1);
insert into public.tasks (id, project_id, business_model_id, name, role, position) values ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '도입 비용 결재', 'buyer', 2);
insert into public.diagnoses (id, project_id, task_id, business_model_id, zone, feasibility_level, demand_level, is_provisional,
  demand_prior, demand_prior_task, agency_assumed, agency_observed, baseline_win_rate, baseline_result, wrapper_risk, confirmation_questions)
  values ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'green', 'L3', 'L2', false,
  3.9, 'Review and classify invoices and receipts (WORKBank 유사 업무, 참고용)', 'H1', 'H3', 0.833333, 'met', 'low',
  '["사무소가 요구하는 분류 정확도는 몇 %이고, 현재 프로토타입은 몇 %인가?","직원이 분류 초안을 고치는 데 건당 몇 초가 드는가?"]'::jsonb);
insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'proprietary_data', 'yes', '사무소별 분류 수정 이력이 쌓인다 (파일럿 3곳에서 월 2천 건)');
insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'integration_depth', 'yes', '주요 세무 프로그램 2종으로 바로 내보내기');
insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'human_expertise', 'yes', '세무사 검수 규칙이 분류 기준에 들어간다');
insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'switching_cost', 'unknown', '아직 확인 전');
insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'regulatory_barrier', 'no', '별도 인증 요건 없음');
insert into public.wrapper_items (project_id, diagnosis_id, item_key, status, evidence_note) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', 'bigtech_overlap', 'unknown', '범용 모델 업체의 회계 기능 로드맵 확인 필요');
insert into public.baseline_tests (id, project_id, diagnosis_id, prompt_used, model, share_token) values ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030',
  '다음 증빙을 한국 기업회계 계정과목으로 분류하라.', 'generic-model', 'example-baseline-token');
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 0, '증빙 샘플 1 (가명 처리됨)', '분류 결과 A', '분류 결과 B', true);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 1, '증빙 샘플 2 (가명 처리됨)', '분류 결과 A', '분류 결과 B', false);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 2, '증빙 샘플 3 (가명 처리됨)', '분류 결과 A', '분류 결과 B', true);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 3, '증빙 샘플 4 (가명 처리됨)', '분류 결과 A', '분류 결과 B', false);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 4, '증빙 샘플 5 (가명 처리됨)', '분류 결과 A', '분류 결과 B', true);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 5, '증빙 샘플 6 (가명 처리됨)', '분류 결과 A', '분류 결과 B', false);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 6, '증빙 샘플 7 (가명 처리됨)', '분류 결과 A', '분류 결과 B', true);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 7, '증빙 샘플 8 (가명 처리됨)', '분류 결과 A', '분류 결과 B', false);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000408', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 8, '증빙 샘플 9 (가명 처리됨)', '분류 결과 A', '분류 결과 B', true);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000409', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 9, '증빙 샘플 10 (가명 처리됨)', '분류 결과 A', '분류 결과 B', false);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000410', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 10, '증빙 샘플 11 (가명 처리됨)', '분류 결과 A', '분류 결과 B', true);
insert into public.baseline_pairs (id, project_id, test_id, sample_index, input_text, output_a, output_b, a_is_ours) values
    ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000040', 11, '증빙 샘플 12 (가명 처리됨)', '분류 결과 A', '분류 결과 B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000400', '평가자A', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000400', '평가자B', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000400', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', '평가자A', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', '평가자B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000401', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000402', '평가자A', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000402', '평가자B', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000402', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000403', '평가자A', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000403', '평가자B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000403', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000404', '평가자A', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000404', '평가자B', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000404', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000405', '평가자A', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000405', '평가자B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000405', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000406', '평가자A', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000406', '평가자B', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000406', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000407', '평가자A', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000407', '평가자B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000407', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000408', '평가자A', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000408', '평가자B', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000408', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000409', '평가자A', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000409', '평가자B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000409', '평가자C', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000410', '평가자A', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000410', '평가자B', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000410', '평가자C', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000411', '평가자A', false);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000411', '평가자B', true);
insert into public.baseline_votes (project_id, pair_id, evaluator, chose_a) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000411', '평가자C', true);
insert into public.cost_models (id, project_id, business_model_id, inputs, results) values ('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '{"tasksPerUser":1500,"callsPerTask":1.2,"inputTokens":1800,"outputTokens":120,"inputPricePerMTok":4200,"outputPricePerMTok":21000,"cacheSaving":0.4,"retryRate":0.05,"reviewHoursPerTask":0,"hourlyWage":0,"monthlyPrice":150000}'::jsonb, '{"costPerTask":{"model":8.890559999999999,"review":0,"total":8.890559999999999},"scenarios":[{"scenario":"uniform","label":"균등","topShare":0.1,"heavyMultiplier":1,"lightMultiplier":1,"avgCost":13335.839999999998,"avgMargin":136664.16,"avgMarginRate":0.9110944,"heavyMargin":136664.16,"lightMargin":136664.16,"heavyLoses":false},{"scenario":"observed","label":"관측 사례","topShare":0.64,"heavyMultiplier":6.3999999999999995,"lightMultiplier":0.39999999999999997,"avgCost":13335.839999999998,"avgMargin":136664.16,"avgMarginRate":0.9110944,"heavyMargin":64650.62400000001,"lightMargin":144665.664,"heavyLoses":false},{"scenario":"extreme","label":"극단","topShare":0.8,"heavyMultiplier":8,"lightMultiplier":0.22222222222222215,"avgCost":13335.839999999998,"avgMargin":136664.16,"avgMarginRate":0.9110944,"heavyMargin":43313.28000000001,"lightMargin":147036.48,"heavyLoses":false}],"sensitivity":[{"case":"price_10x_down","label":"모델 단가 연 10배 하락","breakevenPrice":1333.5839999999998,"heavyBreakevenPrice":8534.937599999997},{"case":"price_half","label":"모델 단가 50% 하락","breakevenPrice":6667.919999999999,"heavyBreakevenPrice":42674.687999999995},{"case":"price_double","label":"모델 단가 2배 상승","breakevenPrice":26671.679999999997,"heavyBreakevenPrice":170698.75199999998},{"case":"output_double","label":"출력 토큰 2배","breakevenPrice":18098.640000000003,"heavyBreakevenPrice":115831.29600000002}],"margin":136664.16}'::jsonb);
insert into public.hypotheses (id, project_id, diagnosis_id, cost_model_id, statement, type, criticality, critical_candidate, evidence_level, rank, status, premortem_reason, drafted_by_llm, edited_by_user)
    values ('00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000050', '세무사 사무실 실무자는 증빙 분류를 AI에 맡기길 원한다', 'demand', 'critical', false, 'L2', 1, 'met', '직원들이 AI 결과를 믿지 않아 결국 다시 손으로 분류했다', true, true);
insert into public.hypotheses (id, project_id, diagnosis_id, cost_model_id, statement, type, criticality, critical_candidate, evidence_level, rank, status, premortem_reason, drafted_by_llm, edited_by_user)
    values ('00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000050', '사무소가 받아들이는 최소 분류 정확도는 95%다', 'accuracy', 'critical', false, 'L3', 2, 'in_progress', '정확도가 기대에 못 미쳐 검토 시간이 오히려 늘었다', true, true);
insert into public.hypotheses (id, project_id, diagnosis_id, cost_model_id, statement, type, criticality, critical_candidate, evidence_level, rank, status, premortem_reason, drafted_by_llm, edited_by_user)
    values ('00000000-0000-4000-8000-000000000062', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000050', '대표 세무사는 8주 검증 파일럿에 선결제한다', 'payment', 'critical', false, 'L0', 3, 'in_progress', null, true, true);
insert into public.hypotheses (id, project_id, diagnosis_id, cost_model_id, statement, type, criticality, critical_candidate, evidence_level, rank, status, premortem_reason, drafted_by_llm, edited_by_user)
    values ('00000000-0000-4000-8000-000000000063', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000050', '실무자는 완전 자동 처리보다 AI 초안 후 직접 검토를 고른다', 'preference', 'major', false, 'L2', 4, 'met', null, true, true);
insert into public.hypotheses (id, project_id, diagnosis_id, cost_model_id, statement, type, criticality, critical_candidate, evidence_level, rank, status, premortem_reason, drafted_by_llm, edited_by_user)
    values ('00000000-0000-4000-8000-000000000064', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000050', '8주 안에 사무소 5곳에서 증빙 샘플 500건을 받을 수 있다', 'data', 'major', false, 'L0', 5, 'unverified', null, true, true);
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', '예시 팀원 1', 'team', 'critical');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', '예시 팀원 2', 'team', 'critical');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', '예시 멘토', 'external', 'critical');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', 'LLM 반대 평가자', 'llm', 'major');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', '예시 팀원 1', 'team', 'critical');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', '예시 팀원 2', 'team', 'major');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', '예시 멘토', 'external', 'critical');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', 'LLM 반대 평가자', 'llm', 'critical');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', '예시 팀원 1', 'team', 'major');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', '예시 팀원 2', 'team', 'major');
insert into public.criticality_ratings (project_id, hypothesis_id, rater_name, rater_type, level) values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', 'LLM 반대 평가자', 'llm', 'minor');
insert into public.proposals (id, project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, guide_steps,
    prerequisites, mvp_scope, recruitment, operating_rules, target_value, min_value, locked_at, expected_rate, sample_size, decision_table,
    conclusion_probability, expected_weeks, status, drafted_by_llm, edited_by_user) values ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', null, 'b2b_followup_meeting', '문제 중심 연락 후 목적이 정해진 후속 미팅 요청', 'L2',
    '["목표 사무소 명단 30곳 작성 (지인 소개 제외)","증빙 분류 시간 문제로 이메일 연락","업무 흐름 관찰을 목적으로 30분 후속 미팅 요청","수락·거절을 사무소 단위로 기록"]'::jsonb, '[]'::jsonb, '개발 없음. 연락 문안과 미팅 안건만 준비', '세무사회 지역 명부에서 무작위 추출',
    '["대상에게 사실대로 알린다","결제·해지 같은 핵심 경로에는 가짜 기능을 쓰지 않는다"]'::jsonb, 0.4, 0.2, now() - interval '20 days', 0.5,
    64, '[{"n":5,"metFrom":3,"failTo":0,"holdFrom":1,"holdTo":2},{"n":10,"metFrom":6,"failTo":0,"holdFrom":1,"holdTo":5},{"n":15,"metFrom":8,"failTo":1,"holdFrom":2,"holdTo":7},{"n":20,"metFrom":10,"failTo":2,"holdFrom":3,"holdTo":9},{"n":30,"metFrom":15,"failTo":4,"holdFrom":5,"holdTo":14}]'::jsonb, 0.809134, 2, 'received', true, true);
insert into public.evidence (id, project_id, proposal_id, method_same, recruitment, attempts, responses, successes, raw_files, has_raw,
      acquaintance_ratio, same_company_count, notice_given, memo, evidence_level, effective_n, effective_successes, cluster_method)
      values ('00000000-0000-4000-8000-000000000170', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000070', true, '세무사회 지역 명부에서 무작위 추출', 28, 28, 16,
      '[{"name":"결과.csv","kind":"csv"}]'::jsonb, true, 0, 1, true, '', 'L2', 28, 16, 'independent');
insert into public.verdicts (id, project_id, hypothesis_id, proposal_id, root_proposal_id, evidence_ids, look_number, n, successes, raw_n,
      target_value, min_value, p_above_target, p_below_min, wilson_low, wilson_high, result, evidence_level)
      values ('00000000-0000-4000-8000-000000000270', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000070', array['00000000-0000-4000-8000-000000000170']::uuid[], 1, 28, 16, 28,
      0.4, 0.2, 0.966697, 0.000007, 0.390708, 0.734915, 'met', 'L2');
insert into public.decisions (project_id, hypothesis_id, verdict_id, recommendation, rationale, choice, reason_type, note, decided_at, is_grounded_change)
      values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000270', 'continue', '목표값을 넘을 확률이 판정 기준(80%) 이상이다.', 'continue', 'evidence', '다음 가설로 넘어간다', now() - interval '5 days', false);
insert into public.proposals (id, project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, guide_steps,
    prerequisites, mvp_scope, recruitment, operating_rules, target_value, min_value, locked_at, expected_rate, sample_size, decision_table,
    conclusion_probability, expected_weeks, status, drafted_by_llm, edited_by_user) values ('00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', null, 'concierge_accuracy', '컨시어지: 정확도 수준을 달리한 수작업 분류 결과를 제공', 'L3',
    '["참여 사무소 10곳에 수작업 분류 결과를 제공 (수작업임을 미리 알림)","사무소마다 정확도 90%·95% 결과를 번갈아 제공","결과를 고치지 않고 장부에 반영한 비율 기록"]'::jsonb, '["사람이 만든 정답이 달린 증빙 샘플"]'::jsonb, '구글 시트 + 사람이 만든 분류 결과', '후속 미팅을 수락한 사무소 중 참여 동의',
    '["대상에게 사실대로 알린다","결제·해지 같은 핵심 경로에는 가짜 기능을 쓰지 않는다"]'::jsonb, 0.6, 0.4, now() - interval '20 days', 0.7,
    58, '[{"n":5,"metFrom":4,"failTo":1,"holdFrom":2,"holdTo":3},{"n":10,"metFrom":8,"failTo":2,"holdFrom":3,"holdTo":7},{"n":15,"metFrom":11,"failTo":4,"holdFrom":5,"holdTo":10},{"n":20,"metFrom":14,"failTo":6,"holdFrom":7,"holdTo":13},{"n":30,"metFrom":21,"failTo":9,"holdFrom":10,"holdTo":20}]'::jsonb, 0.813912, 2, 'received', true, true);
insert into public.evidence (id, project_id, proposal_id, method_same, recruitment, attempts, responses, successes, raw_files, has_raw,
      acquaintance_ratio, same_company_count, notice_given, memo, evidence_level, effective_n, effective_successes, cluster_method)
      values ('00000000-0000-4000-8000-000000000171', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000071', true, '후속 미팅을 수락한 사무소 중 참여 동의', 10, 10, 6,
      '[{"name":"결과.csv","kind":"csv"}]'::jsonb, true, 0, 1, true, '', 'L3', 10, 6, 'independent');
insert into public.verdicts (id, project_id, hypothesis_id, proposal_id, root_proposal_id, evidence_ids, look_number, n, successes, raw_n,
      target_value, min_value, p_above_target, p_below_min, wilson_low, wilson_high, result, evidence_level)
      values ('00000000-0000-4000-8000-000000000271', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000071', '00000000-0000-4000-8000-000000000071', array['00000000-0000-4000-8000-000000000171']::uuid[], 1, 10, 6, 10,
      0.6, 0.4, 0.491044, 0.099629, 0.312674, 0.83182, 'on_hold', 'L3');
insert into public.decisions (project_id, hypothesis_id, verdict_id, recommendation, rationale, choice, reason_type, note, decided_at, is_grounded_change)
      values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000271', 'more_validation', '충족도 미달도 아니다. 표본을 늘린 검증 제안을 보낸다.', 'more_validation', 'evidence', '표본을 늘려 다시 본다', now() - interval '5 days', false);
insert into public.proposals (id, project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, guide_steps,
    prerequisites, mvp_scope, recruitment, operating_rules, target_value, min_value, locked_at, expected_rate, sample_size, decision_table,
    conclusion_probability, expected_weeks, status, drafted_by_llm, edited_by_user) values ('00000000-0000-4000-8000-000000000072', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000061', '00000000-0000-4000-8000-000000000071', 'concierge_accuracy', '컨시어지: 표본을 늘린 재검증', 'L3',
    '["같은 방식으로 사무소 10곳 추가 모집","이전 결과와 합쳐 다시 판정"]'::jsonb, '["사람이 만든 정답이 달린 증빙 샘플"]'::jsonb, '이전과 같음', '신규 사무소 10곳',
    '["대상에게 사실대로 알린다","결제·해지 같은 핵심 경로에는 가짜 기능을 쓰지 않는다"]'::jsonb, 0.6, 0.4, now() - interval '20 days', 0.7,
    58, '[{"n":5,"metFrom":4,"failTo":1,"holdFrom":2,"holdTo":3},{"n":10,"metFrom":8,"failTo":2,"holdFrom":3,"holdTo":7},{"n":15,"metFrom":11,"failTo":4,"holdFrom":5,"holdTo":10},{"n":20,"metFrom":14,"failTo":6,"holdFrom":7,"holdTo":13},{"n":30,"metFrom":21,"failTo":9,"holdFrom":10,"holdTo":20}]'::jsonb, 0.813912, 2, 'awaiting', true, true);
insert into public.proposals (id, project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, guide_steps,
    prerequisites, mvp_scope, recruitment, operating_rules, target_value, min_value, locked_at, expected_rate, sample_size, decision_table,
    conclusion_probability, expected_weeks, status, drafted_by_llm, edited_by_user) values ('00000000-0000-4000-8000-000000000073', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000062', null, 'paid_pilot', '유료 파일럿 제안 (예산 권한자 서명, 환불 불가, 사전 합의 성공 지표)', 'L4',
    '["후속 미팅 사무소 대표에게 8주 파일럿 견적 발송","성공 지표와 결정일을 문서로 합의","결제 여부 기록"]'::jsonb, '[]'::jsonb, '파일럿 계약서와 결제 링크', '후속 미팅 수락 사무소',
    '["대상에게 사실대로 알린다","결제·해지 같은 핵심 경로에는 가짜 기능을 쓰지 않는다"]'::jsonb, 0.25, 0.1, now() - interval '20 days', 0.3,
    207, '[{"n":5,"metFrom":3,"failTo":null,"holdFrom":0,"holdTo":2},{"n":10,"metFrom":4,"failTo":0,"holdFrom":1,"holdTo":3},{"n":15,"metFrom":6,"failTo":0,"holdFrom":1,"holdTo":5},{"n":20,"metFrom":7,"failTo":0,"holdFrom":1,"holdTo":6},{"n":30,"metFrom":10,"failTo":1,"holdFrom":2,"holdTo":9}]'::jsonb, 0.801362, 2, 'sent', true, true);
insert into public.proposals (id, project_id, hypothesis_id, root_proposal_id, method_key, method, evidence_level_expected, guide_steps,
    prerequisites, mvp_scope, recruitment, operating_rules, target_value, min_value, locked_at, expected_rate, sample_size, decision_table,
    conclusion_probability, expected_weeks, status, drafted_by_llm, edited_by_user) values ('00000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', null, 'b2b_mode_choice', '데모 미팅에서 두 방식을 같은 가격으로 제시하고 파일럿 방식을 고르게 함', 'L2',
    '["데모 미팅에서 ''AI가 자동 처리''와 ''AI 초안 후 직접 검토'' 두 안을 같은 가격으로 제시","실제로 고른 방식을 기록"]'::jsonb, '[]'::jsonb, '두 방식의 화면 시안', '후속 미팅 수락 사무소',
    '["대상에게 사실대로 알린다","결제·해지 같은 핵심 경로에는 가짜 기능을 쓰지 않는다"]'::jsonb, 0.6, 0.4, now() - interval '20 days', 0.75,
    23, '[{"n":5,"metFrom":4,"failTo":1,"holdFrom":2,"holdTo":3},{"n":10,"metFrom":8,"failTo":2,"holdFrom":3,"holdTo":7},{"n":15,"metFrom":11,"failTo":4,"holdFrom":5,"holdTo":10},{"n":20,"metFrom":14,"failTo":6,"holdFrom":7,"holdTo":13},{"n":30,"metFrom":21,"failTo":9,"holdFrom":10,"holdTo":20}]'::jsonb, 0.803705, 1, 'received', true, true);
insert into public.evidence (id, project_id, proposal_id, method_same, recruitment, attempts, responses, successes, raw_files, has_raw,
      acquaintance_ratio, same_company_count, notice_given, memo, evidence_level, effective_n, effective_successes, cluster_method)
      values ('00000000-0000-4000-8000-000000000174', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000074', true, '후속 미팅 수락 사무소', 16, 16, 13,
      '[{"name":"결과.csv","kind":"csv"}]'::jsonb, true, 0, 1, true, '', 'L2', 16, 13, 'independent');
insert into public.verdicts (id, project_id, hypothesis_id, proposal_id, root_proposal_id, evidence_ids, look_number, n, successes, raw_n,
      target_value, min_value, p_above_target, p_below_min, wilson_low, wilson_high, result, evidence_level)
      values ('00000000-0000-4000-8000-000000000274', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', '00000000-0000-4000-8000-000000000074', '00000000-0000-4000-8000-000000000074', array['00000000-0000-4000-8000-000000000174']::uuid[], 1, 16, 13, 16,
      0.6, 0.4, 0.963778, 0.000362, 0.569911, 0.934084, 'met', 'L2');
insert into public.decisions (project_id, hypothesis_id, verdict_id, recommendation, rationale, choice, reason_type, note, decided_at, is_grounded_change)
      values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', '00000000-0000-4000-8000-000000000274', 'continue', '목표값을 넘을 확률이 판정 기준(80%) 이상이다.', 'continue', 'evidence', '다음 가설로 넘어간다', now() - interval '5 days', false);
insert into public.metric_cards (project_id, hypothesis_id, event_name, definition, target_value, min_value, locked_at, alert_rule)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000060', 'classification_draft_accepted', '분류 초안을 받은 사무소 중 그 주에 초안을 장부에 반영한 사무소 비율', 0.4, 0.2, now() - interval '3 days',
  '2주 연속 최소 허용치(20%) 아래로 내려가면 알림'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000063', 'review_mode_selected', '새 사무소가 온보딩에서 ''AI 초안 후 직접 검토''를 고른 비율', 0.6, 0.4, now() - interval '3 days', '월간 판정이 미달이면 알림');
insert into public.price_table (model_name, input_per_mtok_krw, output_per_mtok_krw, cached_input_per_mtok_krw)
  values ('example-large', 4200, 21000, 420), ('example-small', 1400, 7000, 140) on conflict (model_name) do nothing;
commit;
