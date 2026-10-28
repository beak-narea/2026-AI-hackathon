-- 기능 확장: 점검 주기, 축 판정, 피치 초안, 연동 자격 증명, 알림, 요청 제한, 멘토 연결,
-- 운영자 기능(기수 성공 기준, 가격 조사, 비용 구조, 품질 점검), 이벤트 기록

-- ── 검증 주기 관리 ─────────────────────────────────────────────────
alter table public.projects
  add column review_cycle_weeks integer not null default 2 check (review_cycle_weeks between 1 and 12),
  add column last_reviewed_at timestamptz,
  add column raw_retention_days integer not null default 365 check (raw_retention_days between 7 and 3650);

create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  reviewed_by  uuid references auth.users (id) on delete set null,
  note         text not null default '',
  snapshot     jsonb not null default '{}'::jsonb,   -- 점검 시점의 경고·상태 요약
  created_at   timestamptz not null default now()
);

-- ── 4구역: 가능성 축·수요 축 판정을 가설 판정에서 받아 저장 ─────────
-- 실무자 수요(demand)와 구매자 수요(buyer_demand)를 따로 받는다. 둘이 엇갈리면 경고.
alter table public.diagnoses
  add column feasibility_verdict public.verdict_result,
  add column demand_verdict public.verdict_result,
  add column buyer_demand_verdict public.verdict_result,
  add column buyer_demand_level public.evidence_level not null default 'L0';

-- 이 가설의 판정이 진단의 어느 축을 채우는가 (diagnosis_id와 함께 쓴다)
alter table public.hypotheses
  add column diagnosis_axis text check (diagnosis_axis in ('feasibility', 'demand', 'buyer_demand'));

-- 원자료 파일 목록 (가명 처리된 사본만 저장. 보관 기간이 지나면 지운다)
create table public.raw_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  proposal_id  uuid references public.proposals (id) on delete set null,
  path         text not null unique,
  name         text not null,
  kind         text not null,
  size_bytes   integer not null default 0,
  pseudonymized jsonb not null default '{}'::jsonb,
  uploaded_by  uuid references auth.users (id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.raw_files (project_id, created_at);

-- 전사본 코딩: 일치도 기준을 넘지 못한 코드 유형의 인사이트는 사람이 검토·확정한다
alter table public.insights add column needs_review boolean not null default true;
alter table public.transcripts add column quality_validated boolean not null default false;

-- ── 판매 테스트용 피치·데모 초안 (제작·실행은 고객 팀) ─────────────
create table public.pitch_drafts (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  proposal_id    uuid references public.proposals (id) on delete cascade,
  hypothesis_id  uuid references public.hypotheses (id) on delete cascade,
  content        jsonb not null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- ── 데이터 연결: 가져오기 연동 (PostHog·Amplitude·Langfuse) ─────────
alter table public.data_connections
  add column provider text not null default 'webhook' check (provider in ('webhook', 'posthog', 'amplitude', 'langfuse'));
alter table public.connection_secrets
  alter column token_hash drop not null,
  add column encrypted_config text;   -- AES-256-GCM (ENCRYPTION_KEY), 서버만 복호화

-- 지표 카드를 어떤 이벤트로 잴지 (가져오기 연동용)
alter table public.metric_cards
  add column source jsonb;   -- { numerator_event, denominator_event, window_days }

-- ── 알림 ───────────────────────────────────────────────────────────
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null default '',
  link        text,
  emailed     boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.notifications (user_id, read_at);
-- 같은 알림을 반복해 보내지 않기 위한 열쇠
alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ── 요청 제한 (서버리스에서도 공유되는 카운터) ─────────────────────
create table public.rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  count         integer not null
);

create or replace function public.consume_rate_limit(k text, lim integer, window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  now_ts timestamptz := now();
  cur public.rate_limits;
begin
  select * into cur from public.rate_limits where key = k for update;
  if cur.key is null or cur.window_start < now_ts - make_interval(secs => window_seconds) then
    insert into public.rate_limits (key, window_start, count) values (k, now_ts, 1)
    on conflict (key) do update set window_start = now_ts, count = 1;
    return true;
  end if;
  if cur.count >= lim then
    return false;
  end if;
  update public.rate_limits set count = count + 1 where key = k;
  return true;
end $$;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- ── 외부 평가자 연결 (제휴 멘토) ───────────────────────────────────
create table public.mentors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  organization  text not null default '',
  expertise     text[] not null default '{}',
  fee_krw       integer not null default 0 check (fee_krw >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.mentor_requests (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  hypothesis_id  uuid references public.hypotheses (id) on delete set null,
  mentor_id      uuid references public.mentors (id) on delete set null,
  requested_by   uuid references auth.users (id) on delete set null,
  topic          text not null default '',
  status         text not null default 'requested' check (status in ('requested', 'matched', 'done', 'cancelled')),
  fee_krw        integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── 운영자: 기수별 성공 기준 ───────────────────────────────────────
-- 목표값·최소 허용치는 처음 잠근 값(코드 상수)을 기수가 늘어도 그대로 쓴다
create table public.cohorts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  started_at  date not null default current_date,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create table public.cohort_teams (
  id          uuid primary key default gen_random_uuid(),
  cohort_id   uuid not null references public.cohorts (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete set null,
  team_name   text not null,
  is_design_partner boolean not null default false,
  -- 지불 기준: 정해 둔 날 같은 가격으로 선결제를 제안하고 2주 안에 결제했는가 (운영자가 기록)
  offered_at  date,
  prepaid     boolean,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

-- ── 운영자: Van Westendorp 가격 조사 ───────────────────────────────
create table public.price_surveys (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text not null default '',
  share_token  text not null unique default replace(gen_random_uuid()::text, '-', ''),
  open         boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.price_responses (
  id             uuid primary key default gen_random_uuid(),
  survey_id      uuid not null references public.price_surveys (id) on delete cascade,
  respondent     text not null,
  too_cheap      numeric not null check (too_cheap >= 0),
  cheap          numeric not null check (cheap >= 0),
  expensive      numeric not null check (expensive >= 0),
  too_expensive  numeric not null check (too_expensive >= 0),
  created_at     timestamptz not null default now(),
  unique (survey_id, respondent)
);

-- ── 운영자: 우리 서비스 비용 구조 입력값 (한 줄) ───────────────────
create table public.service_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ── 품질 점검: 아첨 점검 실행, 채점기 사람 라벨 ─────────────────────
create table public.eval_runs (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('weakness', 'framing', 'pushback')),
  prompt_versions  jsonb not null,
  versions_hash    text not null,
  model            text not null,
  metrics          jsonb not null,
  passed           boolean not null,
  details          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index on public.eval_runs (versions_hash, kind, created_at);

create table public.grader_labels (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.eval_runs (id) on delete cascade,
  item_key      text not null,
  grader_value  boolean not null,
  human_value   boolean,
  labeled_by    uuid references auth.users (id) on delete set null,
  unique (run_id, item_key)
);

-- ── 품질 점검: 전사본 코딩 일치도 ──────────────────────────────────
create table public.coding_sets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code_types  text[] not null,
  created_at  timestamptz not null default now()
);

create table public.coding_segments (
  id      uuid primary key default gen_random_uuid(),
  set_id  uuid not null references public.coding_sets (id) on delete cascade,
  idx     integer not null,
  text    text not null,
  unique (set_id, idx)
);

create table public.coding_labels (
  id          uuid primary key default gen_random_uuid(),
  segment_id  uuid not null references public.coding_segments (id) on delete cascade,
  coder       text not null,   -- 'llm' 또는 사람 사용자 id
  code_type   text not null,   -- 코드 유형 하나 또는 '없음'
  created_at  timestamptz not null default now(),
  unique (segment_id, coder)
);

-- 코드 유형별 판정: auto(α≥0.800) / review(0.667~0.800) / off(<0.667 또는 표본 부족)
create table public.code_type_status (
  code_type    text primary key,
  alpha        numeric,
  n_units      integer not null,
  required     integer not null,
  status       text not null check (status in ('auto', 'review', 'off')),
  computed_at  timestamptz not null default now()
);

-- ── 설계 가정 추적용 이벤트 ─────────────────────────────────────────
create table public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  project_id  uuid references public.projects (id) on delete set null,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index on public.events (name, user_id);

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.reviews          enable row level security;
alter table public.pitch_drafts     enable row level security;
alter table public.notifications    enable row level security;
alter table public.rate_limits      enable row level security;
alter table public.mentors          enable row level security;
alter table public.mentor_requests  enable row level security;
alter table public.cohorts          enable row level security;
alter table public.cohort_teams     enable row level security;
alter table public.price_surveys    enable row level security;
alter table public.price_responses  enable row level security;
alter table public.service_settings enable row level security;
alter table public.eval_runs        enable row level security;
alter table public.grader_labels    enable row level security;
alter table public.coding_sets      enable row level security;
alter table public.coding_segments  enable row level security;
alter table public.coding_labels    enable row level security;
alter table public.code_type_status enable row level security;
alter table public.events           enable row level security;
alter table public.raw_files        enable row level security;

create policy reviews_read on public.reviews for select to authenticated using (public.is_project_member(project_id));
create policy pitch_read on public.pitch_drafts for select to anon, authenticated using (public.can_read_project(project_id));
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy raw_files_read on public.raw_files for select to authenticated using (public.is_project_member(project_id));
create policy mentor_requests_read on public.mentor_requests for select to authenticated using (public.is_project_member(project_id));
create policy code_type_status_read on public.code_type_status for select to authenticated using (true);
-- 나머지(운영자 테이블, 요청 제한, 이벤트)는 정책 없음: service role만 접근

-- 알림은 읽음 표시만 사용자가 바꾼다
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
-- 서버(service role) 전용 함수는 명시적으로 허용해 둔다
grant execute on function public.user_id_by_email(text) to service_role;

-- 메일 알림 받기 (계정 화면에서 끈다)
alter table public.profiles add column email_notifications boolean not null default true;
