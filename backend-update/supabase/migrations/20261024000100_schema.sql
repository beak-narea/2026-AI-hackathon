-- AI 스타트업 검증 서비스: 핵심 스키마
-- 뼈대는 "가설 → 검증 제안 → 증거 → 판정 → 결정" 사슬이다.
-- enum 값은 Figma 컴포넌트 variant 이름과 같다 (design handoff 규칙).

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ── enum ──────────────────────────────────────────────────────────────
create type public.project_status     as enum ('active', 'archived');
create type public.member_role        as enum ('owner', 'member', 'external_rater');
create type public.task_role          as enum ('practitioner', 'buyer');
create type public.zone               as enum ('green', 'red', 'rnd', 'low');
create type public.evidence_level     as enum ('L0', 'L1', 'L2', 'L3', 'L4');
create type public.agency_level       as enum ('H1', 'H2', 'H3', 'H4', 'H5');
create type public.tri_status         as enum ('yes', 'no', 'unknown');
create type public.wrapper_item_key   as enum ('proprietary_data', 'integration_depth', 'human_expertise',
                                               'switching_cost', 'regulatory_barrier', 'bigtech_overlap');
create type public.risk_level         as enum ('high', 'mid', 'low');
create type public.hypothesis_type    as enum ('trust', 'accuracy', 'data', 'demand', 'preference',
                                               'feasibility', 'payment', 'other');
create type public.criticality        as enum ('critical', 'major', 'minor');
create type public.hypothesis_status  as enum ('unverified', 'in_progress', 'met', 'not_met', 'on_hold', 'needs_recheck');
create type public.rater_type         as enum ('team', 'external', 'llm');
create type public.proposal_status    as enum ('draft', 'sent', 'awaiting', 'received');
create type public.verdict_result     as enum ('met', 'not_met', 'on_hold', 'no_conclusion');
create type public.decision_choice    as enum ('continue', 'revise', 'stop', 'more_validation');
create type public.reason_type        as enum ('evidence', 'external', 'other');
create type public.connection_kind    as enum ('analytics', 'llm_monitoring');
create type public.connection_status  as enum ('connected', 'error', 'disconnected');
create type public.source_kind        as enum ('text', 'pdf', 'url', 'image');
create type public.cluster_method     as enum ('independent', 'design_effect', 'cluster_unit');

-- ── 사용자·약관 ──────────────────────────────────────────────────────
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  display_name          text,
  terms_version         text,
  terms_accepted_at     timestamptz,
  -- 데이터 활용·비식별 조항은 별도 동의로 받는다
  data_use_version      text,
  data_use_accepted_at  timestamptz,
  created_at            timestamptz not null default now()
);

-- ── 프로젝트 ─────────────────────────────────────────────────────────
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references auth.users (id) on delete set null,
  name            text not null check (length(name) between 1 and 120),
  idea_text       text not null default '',
  is_example      boolean not null default false,
  is_b2b          boolean not null default false,
  status          public.project_status not null default 'active',
  archived_at     timestamptz,
  archive_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.projects (owner_id);

create table public.project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '',
  role        public.member_role not null default 'member',
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  unique (project_id, email)
);
create index on public.project_members (user_id);

create table public.source_files (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  kind            public.source_kind not null,
  storage_path    text,
  url             text,
  extracted_text  text,
  created_at      timestamptz not null default now()
);

-- ── 사업 모델 (Lean Canvas, 버전 관리) ──────────────────────────────
create table public.business_models (
  id                        uuid primary key default gen_random_uuid(),
  project_id                uuid not null references public.projects (id) on delete cascade,
  version                   integer not null check (version >= 1),
  parent_version            integer,
  variant_label             text,          -- 변형 아이디어 비교용 이름
  problem                   text not null default '',
  customer_segments         text not null default '',
  unique_value_proposition  text not null default '',
  solution                  text not null default '',
  channels                  text not null default '',
  revenue_streams           text not null default '',
  cost_structure            text not null default '',
  key_metrics               text not null default '',
  unfair_advantage          text not null default '',
  extracted_by_llm          boolean not null default false,
  edited_by_user            boolean not null default false,
  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  unique (project_id, version)
);

-- 제품이 대신하려는 업무
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  business_model_id  uuid references public.business_models (id) on delete set null,
  name               text not null,
  role               public.task_role not null default 'practitioner',
  position           integer not null default 0,
  created_at         timestamptz not null default now()
);

-- ── 진단 ─────────────────────────────────────────────────────────────
create table public.diagnoses (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete cascade,
  task_id               uuid references public.tasks (id) on delete cascade,
  business_model_id     uuid references public.business_models (id) on delete set null,
  zone                  public.zone,                    -- null = 아직 판정 전
  feasibility_level     public.evidence_level not null default 'L0',
  demand_level          public.evidence_level not null default 'L0',
  is_provisional        boolean not null default true,  -- L2 미만이면 "잠정"
  -- WORKBank 사전값: 참고용 추정, 판정에 쓰지 않는다
  demand_prior          numeric,
  demand_prior_task     text,
  agency_assumed        public.agency_level,
  agency_observed       public.agency_level,
  baseline_win_rate     numeric check (baseline_win_rate between 0 and 1),
  baseline_result       public.verdict_result,
  wrapper_risk          public.risk_level,
  confirmation_questions jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.diagnoses (project_id);

create table public.wrapper_items (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  diagnosis_id   uuid not null references public.diagnoses (id) on delete cascade,
  item_key       public.wrapper_item_key not null,
  status         public.tri_status not null default 'unknown',  -- 판정은 사용자가 한다
  evidence_note  text not null default '',                       -- LLM은 초안만
  evidence_url   text,
  unique (diagnosis_id, item_key)
);

-- 블라인드 기준선 테스트
create table public.baseline_tests (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  diagnosis_id  uuid references public.diagnoses (id) on delete set null,
  prompt_used   text not null,
  model         text not null,
  share_token   text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now()
);

create table public.baseline_pairs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  test_id       uuid not null references public.baseline_tests (id) on delete cascade,
  sample_index  integer not null,
  input_text    text not null,
  output_a      text not null,
  output_b      text not null,
  a_is_ours     boolean not null,   -- 평가 화면에는 절대 내보내지 않는다
  unique (test_id, sample_index)
);

create table public.baseline_votes (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  pair_id     uuid not null references public.baseline_pairs (id) on delete cascade,
  evaluator   text not null,        -- 평가자 별칭 (식별자 아님)
  chose_a     boolean not null,
  created_at  timestamptz not null default now(),
  unique (pair_id, evaluator)
);

-- ── 비용 모델 ────────────────────────────────────────────────────────
create table public.price_table (
  id                      uuid primary key default gen_random_uuid(),
  model_name              text not null unique,
  input_per_mtok_krw      numeric not null,
  output_per_mtok_krw     numeric not null,
  cached_input_per_mtok_krw numeric,
  updated_at              timestamptz not null default now()
);

create table public.cost_models (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  business_model_id   uuid references public.business_models (id) on delete set null,
  inputs              jsonb not null,
  results             jsonb not null,
  price_table_updated_at timestamptz,
  created_at          timestamptz not null default now()
);

-- ── 가설 ─────────────────────────────────────────────────────────────
create table public.hypotheses (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  diagnosis_id        uuid references public.diagnoses (id) on delete set null,
  cost_model_id       uuid references public.cost_models (id) on delete set null,
  statement           text not null,
  type                public.hypothesis_type not null default 'other',
  criticality         public.criticality,            -- 팀 합의 값 (평정은 criticality_ratings)
  critical_candidate  boolean not null default false, -- 진단 신호 (빨간불·래퍼 높음·마진 음수)
  evidence_level      public.evidence_level not null default 'L0',
  rank                integer,
  status              public.hypothesis_status not null default 'unverified',
  premortem_reason    text,
  drafted_by_llm      boolean not null default false,
  edited_by_user      boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on public.hypotheses (project_id);

create table public.criticality_ratings (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  hypothesis_id  uuid not null references public.hypotheses (id) on delete cascade,
  rater_user_id  uuid references auth.users (id) on delete set null,
  rater_name     text not null,
  rater_type     public.rater_type not null,
  level          public.criticality not null,
  note           text not null default '',
  needs_review   boolean not null default false,
  created_at     timestamptz not null default now()
);
-- 사람 평가자는 가설당 한 번, LLM 반대 평가자는 가설당 하나
alter table public.criticality_ratings
  add constraint criticality_ratings_human_once unique (hypothesis_id, rater_user_id);
create unique index criticality_ratings_llm_once
  on public.criticality_ratings (hypothesis_id) where rater_type = 'llm';

-- ── 검증 제안 (검증 실험 및 MVP 기획서) ─────────────────────────────
create table public.proposals (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects (id) on delete cascade,
  hypothesis_id           uuid not null references public.hypotheses (id) on delete cascade,
  -- 재판정 사슬: 판정 보류 뒤 표본을 늘린 제안은 root를 공유하고 목표값·최소 허용치를 물려받는다
  root_proposal_id        uuid references public.proposals (id) on delete cascade,
  look_number             integer not null default 1 check (look_number between 1 and 4),
  method_key              text not null,
  method                  text not null,
  evidence_level_expected public.evidence_level not null,
  guide_steps             jsonb not null default '[]'::jsonb,
  prerequisites           jsonb not null default '[]'::jsonb,
  mvp_scope               text not null default '',
  recruitment             text not null default '',
  script                  text not null default '',
  operating_rules         jsonb not null default '[]'::jsonb,
  target_value            numeric not null check (target_value > 0 and target_value < 1),
  min_value               numeric not null check (min_value > 0 and min_value < 1),
  locked_at               timestamptz,
  expected_rate           numeric check (expected_rate > 0 and expected_rate < 1),
  sample_size             integer check (sample_size > 0),
  decision_table          jsonb not null default '[]'::jsonb,
  conclusion_probability  numeric,
  expected_weeks          numeric,
  cluster_size            numeric,
  icc                     numeric check (icc between 0 and 1),
  status                  public.proposal_status not null default 'draft',
  pdf_path                text,
  drafted_by_llm          boolean not null default false,
  edited_by_user          boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (target_value > min_value)
);
create index on public.proposals (hypothesis_id);
create index on public.proposals (root_proposal_id);

-- ── 증거 (결과 제출 폼) ──────────────────────────────────────────────
create table public.evidence (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  proposal_id          uuid not null references public.proposals (id) on delete cascade,
  submitted_by         uuid references auth.users (id) on delete set null,
  method_same          boolean not null,
  method_diff_reason   text,
  recruitment          text not null,
  attempts             integer not null check (attempts >= 0),
  responses            integer not null check (responses >= 0),
  successes            integer not null check (successes >= 0),
  clusters             integer check (clusters > 0),
  cluster_successes    integer check (cluster_successes >= 0),
  raw_files            jsonb not null default '[]'::jsonb,
  has_raw              boolean not null default false,
  acquaintance_ratio   numeric check (acquaintance_ratio between 0 and 1),
  same_company_count   integer check (same_company_count >= 0),
  notice_given         boolean,
  pilot_conditions     jsonb,        -- 유료 파일럿 7조건 충족 여부
  memo                 text not null default '',
  evidence_level       public.evidence_level not null,
  effective_n          numeric,
  effective_successes  numeric,
  cluster_method       public.cluster_method,
  quality_flags        jsonb not null default '[]'::jsonb,
  source               text not null default 'form',  -- form | integration
  created_at           timestamptz not null default now(),
  check (successes <= responses and responses <= attempts),
  check (method_same or method_diff_reason is not null)
);
create index on public.evidence (proposal_id);

-- 인터뷰 전사본 (가명 처리된 본문만 저장)
create table public.transcripts (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  evidence_id        uuid references public.evidence (id) on delete cascade,
  pseudonymized_text text not null,
  leading_ratio      numeric,
  future_ratio       numeric,
  past_ratio         numeric,
  low_trust          boolean,
  created_at         timestamptz not null default now()
);

create table public.insights (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  transcript_id  uuid not null references public.transcripts (id) on delete cascade,
  text           text not null,
  code_type      text not null,
  is_interpretive boolean not null default false, -- 해석형 코드는 사람이 확정
  confirmed_by_user boolean not null default false,
  quotes         jsonb not null,                  -- 원문과 문자열 대조를 통과한 인용만
  created_at     timestamptz not null default now()
);

-- ── 판정 ─────────────────────────────────────────────────────────────
create table public.verdicts (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  hypothesis_id    uuid not null references public.hypotheses (id) on delete cascade,
  proposal_id      uuid not null references public.proposals (id) on delete cascade,
  root_proposal_id uuid not null references public.proposals (id) on delete cascade,
  evidence_ids     uuid[] not null,
  look_number      integer not null check (look_number between 1 and 4),
  n                numeric not null,
  successes        numeric not null,
  raw_n            integer not null,
  target_value     numeric not null,
  min_value        numeric not null,
  p_above_target   numeric not null,
  p_below_min      numeric not null,
  wilson_low       numeric not null,
  wilson_high      numeric not null,
  result           public.verdict_result not null,
  evidence_level   public.evidence_level not null,
  created_at       timestamptz not null default now()
);
create index on public.verdicts (hypothesis_id);

-- ── 결정 ─────────────────────────────────────────────────────────────
create table public.decisions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  hypothesis_id   uuid not null references public.hypotheses (id) on delete cascade,
  verdict_id      uuid references public.verdicts (id) on delete set null,
  recommendation  public.decision_choice not null,
  rationale       text not null,
  choice          public.decision_choice not null,
  reason_type     public.reason_type not null,
  note            text not null default '',
  decided_by      uuid references auth.users (id) on delete set null,
  decided_at      timestamptz not null default now(),
  -- 서비스 성공 기준 "근거 있는 수정·중단" (코드로 계산해 저장)
  is_grounded_change boolean not null default false
);

-- ── 출시 후 ──────────────────────────────────────────────────────────
create table public.metric_cards (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  hypothesis_id   uuid not null references public.hypotheses (id) on delete cascade,
  event_name      text not null check (event_name ~ '^[a-z][a-z0-9_]*$'),
  definition      text not null,
  target_value    numeric not null check (target_value > 0 and target_value < 1),
  min_value       numeric not null check (min_value > 0 and min_value < 1),
  relocked        boolean not null default false,  -- 출시 후 정의가 달라 다시 잠갔는가
  locked_at       timestamptz,
  alert_rule      text not null default '',
  actual_value    numeric,
  actual_n        integer,
  recheck_result  public.verdict_result,
  observed_at     timestamptz,
  created_at      timestamptz not null default now(),
  check (target_value > min_value)
);

create table public.data_connections (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  tool_name     text not null,
  kind          public.connection_kind not null,
  status        public.connection_status not null default 'disconnected',
  config        jsonb not null default '{}'::jsonb,  -- 비밀값은 넣지 않는다 (connection_secrets)
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- ── LLM 호출 기록 (프롬프트·모델 버전·토큰 비용) ────────────────────
create table public.llm_calls (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects (id) on delete set null,
  user_id        uuid references auth.users (id) on delete set null,
  purpose        text not null,
  prompt_version text not null,
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_krw       numeric not null default 0,
  latency_ms     integer,
  ok             boolean not null,
  error          text,
  created_at     timestamptz not null default now()
);
create index on public.llm_calls (project_id, created_at);

-- ── WORKBank 참조 데이터 (비상업적 용도, 출처: Shao et al.) ─────────
create table public.workbank_tasks (
  id               bigint generated always as identity primary key,
  occupation       text not null,
  task_statement   text not null,
  automation_desire numeric,   -- 노동자 자동화 희망 점수 (참고용)
  human_agency     text,
  embedding        extensions.vector(1024)
);

-- ── 비공개 테이블: 가명 키와 연동 토큰 (RLS 정책 없음 = service role만 접근) ──
-- 원자료(가명 처리본)와 가명 키를 분리 보관한다.
create table public.pseudonym_keys (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  token       text not null,
  original    text not null,
  kind        text not null,
  created_at  timestamptz not null default now(),
  unique (project_id, token)
);

create table public.connection_secrets (
  connection_id  uuid primary key references public.data_connections (id) on delete cascade,
  token_hash     text not null unique,
  created_at     timestamptz not null default now()
);

-- 출시 후 관측값 (연동 또는 수동 입력)
create table public.metric_observations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  metric_card_id  uuid not null references public.metric_cards (id) on delete cascade,
  successes       numeric not null check (successes >= 0),
  n               numeric not null check (n > 0),
  period_start    timestamptz,
  period_end      timestamptz,
  source          text not null default 'manual',
  result          public.verdict_result not null,
  p_above_target  numeric not null,
  p_below_min     numeric not null,
  created_at      timestamptz not null default now(),
  check (successes <= n)
);

-- 실제 AI 비용 관측값 (LLM 모니터링 도구 연동)
create table public.cost_observations (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  period_start   timestamptz not null,
  period_end     timestamptz not null,
  total_cost_krw numeric not null check (total_cost_krw >= 0),
  tasks          integer not null check (tasks > 0),
  source         text not null,
  created_at     timestamptz not null default now()
);
