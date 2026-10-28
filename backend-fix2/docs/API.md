# API 명세 — 디자인(Figma) 연결용

Figma 레이어 이름 규칙과 이 API를 1:1로 맞춘다.

| Figma 레이어 | 연결 |
|---|---|
| `action:<key>` | 아래 "action 목록"의 엔드포인트 호출 |
| `bind:<entity>.<field>` | 해당 화면 GET 응답의 같은 이름 필드 (DB 열 이름 = 필드 키) |
| `input:<entity>.<field>` | 해당 action 요청 본문의 같은 이름 필드 |
| `list:<entity>` | GET 응답의 배열 |
| 컴포넌트 variant | DB enum 값 그대로 (`met`, `L3`, `critical` …) |

## 공통

- 기본 주소: `/api`
- 인증: Supabase Auth 세션 쿠키(웹) 또는 `Authorization: Bearer <access_token>`
- 브라우저에서 Supabase 테이블·저장소를 직접 읽거나 쓰지 않는다 (권한이 없다). 로그인(Supabase Auth)만 클라이언트에서 직접 하고, 나머지는 모두 이 API를 쓴다.
- 예시 프로젝트와 읽기 전용 GET은 로그인 없이 된다. 예시 프로젝트에 쓰기를 하면 `403 example_read_only`
- 오류 형식 (모든 라우트 동일)

```json
{ "error": { "code": "validation", "message": "입력값이 올바르지 않다", "details": { "fieldErrors": { "successes": ["..."] } } } }
```

| status | code | 뜻 |
|---|---|---|
| 400 | `bad_request` | 형식 오류, 없는 항목을 가리키는 id |
| 401 | `unauthorized` | 로그인 필요 |
| 403 | `forbidden`, `example_read_only`, `terms_required` | 권한 없음 |
| 404 | `not_found` | 없음 |
| 409 | `conflict`, `rule_violation`, `terms_outdated`(약관이 바뀌어 다시 동의 필요) | 규칙 위반 (잠긴 기준 변경, 재판정 상한 등), 이미 있는 항목(같은 요청을 두 번 보냄), 이미 기다리는 재판정, 최신이 아닌 판정으로 결정 |
| 422 | `validation` | 입력 검증 실패. `details.fieldErrors`(칸별, 한국어 문구)는 칸 옆에, `details.formErrors`(여러 칸에 걸친 규칙, 예: 성공 ≤ 응답 ≤ 시도)는 폼 아래에 보여 준다 |
| 429 | `rate_limited`, `llm_budget_exceeded` | 요청 수 제한, 프로젝트 월 AI 사용 한도 |
| 502 | `llm_failed` | LLM 호출 실패 (다시 시도) |
| 503 | `misconfigured` | 서버 환경 변수 누락 |

## action 목록

`{pid}` = 프로젝트 id. 시간이 오래 걸리는 LLM 호출은 ⏳ (최대 1~5분, 로딩 상태 필요).

| action | 메서드·경로 | 본문 / 쿼리 | 화면 |
|---|---|---|---|
| — | `GET /api/session` | 로그인 상태, 약관 동의 여부, 로그인 방식(`demo`/`supabase`) | 모든 화면 |
| — | `GET /api/projects/{pid}/verdicts` | 판정 목록 (가설 문장, 방법 포함) | verdict |
| `auth.sign_in`, `auth.sign_up` | Supabase Auth 클라이언트 직접 호출 | 이메일 링크 → `/auth/callback?next=`. 초대 메일처럼 토큰이 주소 `#` 뒤에 오는 링크는 `/auth/finish`가 마무리한다. 실패하면 `/login?auth_error=<안내 문구>` | auth |
| `terms.accept` | `POST /api/auth/terms` | `{ terms: true, data_use: bool, version }` (`GET`으로 현재 버전) | auth |
| — | `GET /api/projects` | 응답 `{ examples[], projects[] }` | project_list |
| `project.create` | `POST /api/projects` | `{ name, idea_text, is_b2b }` | project_create |
| `example.open` | `GET /api/projects/{예시 id}` | 로그인 불필요 | project_list |
| — | `GET /api/projects/{pid}` | 대시보드: `hypothesis_status_counts`, `pending_proposals[]`, `recent_verdicts[]`, `next_actions[]` | dashboard |
| — | `POST /api/projects/{pid}/source-files` | multipart `file` (PDF·이미지) → `{ path }`. `business_model.extract`의 `files[]`에는 여기서 받은 경로만 넣을 수 있다 | project_create |
| `business_model.extract` ⏳ | `POST /api/projects/{pid}/business-models/extract` | `{ text?, urls?[], files?[] }` → `{ business_model, tasks[], missing[], notes[] }` | business_model |
| `business_model.save_version` | `POST /api/projects/{pid}/business-models` | 캔버스 9칸 + `parent_version?`, `variant_label?`, `tasks?[]` | business_model |
| — | `GET /api/projects/{pid}/business-models` | `{ versions[] }` (각 버전에 `tasks[]`) | business_model |
| `business_model.compare` | `GET /api/projects/{pid}/business-models/compare?a=1&b=2` | `{ changes[{ field, a, b }] }` | business_model |
| `diagnosis.run` ⏳ | `POST /api/projects/{pid}/diagnoses/run` | 업무별 진단 생성. 같은 사업 모델 버전에서 이미 진단한 업무는 건너뛰고 `already_diagnosed`로 알려 준다 | diagnosis |
| — | `GET /api/projects/{pid}/diagnoses` | `{ diagnoses[] }` (각각 `tasks`, `wrapper_items[]`, `baseline_tests[]`) | diagnosis |
| `diagnosis.update_task` | `PATCH /api/projects/{pid}/diagnoses/{diagnosisId}` | `{ agency_assumed?, agency_observed?, wrapper_items?[{ item_key, status, evidence_note? }], feasibility?, demand? }` → 구역·위험 등급은 서버가 다시 계산 | diagnosis |
| `baseline_test.start` ⏳ | `POST /api/projects/{pid}/baseline-tests` | `{ diagnosis_id?, instruction, samples[{ input, ours }] }` (10개 이상, `diagnosis_id`는 같은 프로젝트의 것) → `{ evaluator_url }` | diagnosis |
| — | `GET /api/projects/{pid}/baseline-tests/{testId}/result` | 샘플당 다수결 결과 보기 (읽기만, 진단을 바꾸지 않음) | diagnosis |
| `baseline_test.apply` | `POST /api/projects/{pid}/baseline-tests/{testId}/result` | 결과를 진단의 대체 위험 항목에 반영 (편집 권한) | diagnosis |
| — | `GET /api/baseline/{token}` · `POST /api/baseline/{token}/votes` | 평가자 공개 화면 (로그인 없음) `{ evaluator, votes[{ pair_id, chose_a }] }` (같은 `pair_id` 중복 불가, 평가자 100명까지) | (별도 평가 페이지) |
| `cost_model.recalculate` | `POST /api/projects/{pid}/cost-model` | `{ model_name?, tasksPerUser, callsPerTask, inputTokens, outputTokens, monthlyPrice, … }` → `scenarios[]`, `sensitivity[]` | diagnosis |
| — | `GET /api/price-table` | 모델 단가표 | diagnosis |
| `hypothesis.create` ⏳ | `POST /api/projects/{pid}/hypotheses` | `{ draft: true }` = 사전 부검 초안, 또는 `{ statement, type }` | hypotheses |
| — | `GET /api/projects/{pid}/hypotheses` | 순위순 `hypotheses[]` (각각 `ratings[]`(평정자 계정 id 대신 `mine: bool`), `consensus`, `outside_view`). 평정할 수 있는데 아직 안 한 가정이 있는 사람에게는 남의 평정·중요도·합의를 숨기고(`ratings_hidden`), 순서도 만든 순서로 바꾸고 `rank: null` | hypotheses |
| `hypothesis.rate_criticality` | `POST /api/projects/{pid}/hypotheses/{hid}/ratings` | `{ level, note }` (본인 평정, 서로 안 보이게 UI 처리) | hypotheses |
| — | `POST /api/projects/{pid}/hypotheses/{hid}/settle` | `{ level }` 토론 후 확정 | hypotheses |
| — | `POST /api/projects/{pid}/hypotheses/devils-advocate` ⏳ | LLM 반대 평가자 → `needs_review[]` | hypotheses |
| `hypothesis.reorder` | `POST /api/projects/{pid}/hypotheses/reorder` | 중요도 → 증거가 약한 것 순 | hypotheses |
| — | `GET /api/projects/{pid}/hypotheses/{hid}/methods` | 쓸 수 있는 실험 방법 | proposal |
| `proposal.generate` ⏳ | `POST /api/projects/{pid}/proposals` | `{ hypothesis_id, method_key?, target_value?, min_value?, expected_rate? }` | proposal |
| — | `GET /api/projects/{pid}/proposals/{proposalId}` | `{ proposal, hypothesis, evidence[], verdicts[] }` | proposal, verdict |
| — | `PATCH /api/projects/{pid}/proposals/{proposalId}` | 실행 가이드 문구 수정 | proposal |
| `proposal.lock_thresholds` | `POST /api/projects/{pid}/proposals/{proposalId}/lock` | `{ target_value, min_value, expected_rate, cluster_size?, icc? }` → 이후 기준 변경 불가 | proposal |
| `proposal.export_pdf` | `GET /api/projects/{pid}/proposals/{proposalId}/pdf` | PDF 파일 | proposal |
| `evidence.upload_raw` | `POST /api/projects/{pid}/proposals/{proposalId}/raw-files` | multipart `file`, `names?`, `companies?` → `{ path, name, kind }` (가명 처리 후 저장, 팀원만) | results |
| `evidence.submit` | `POST /api/projects/{pid}/proposals/{proposalId}/evidence` | 결과 제출 폼 (아래) → `{ evidence, verdict }` | results → verdict |
| `verdict.rejudge` | `POST /api/projects/{pid}/proposals/{proposalId}/rejudge` | 판정 보류일 때만, 최대 4회. 이미 결과를 기다리는 재판정 제안이 있으면 409 (동시에 두 번 보내도 DB가 한 회차만 만든다) | verdict |
| — | `POST /api/projects/{pid}/transcripts` ⏳ | `{ text, evidence_id?, names?, companies? }` → 인사이트(인용 검증), 질문 품질 | results |
| — | `GET /api/projects/{pid}/hypotheses/{hid}/recommendation` | 최신 판정 + 서비스 권고 | decision |
| `decision.record` | `POST /api/projects/{pid}/decisions` | `{ hypothesis_id, verdict_id?, choice, reason_type, note? }` → `next_screen`. `verdict_id`는 그 가설의 최신 판정이어야 한다 (아니면 409) | decision |
| `metric_card.create` | `POST /api/projects/{pid}/metric-cards` | 충족한 가설만 | post_launch |
| — | `PATCH /api/projects/{pid}/metric-cards/{cardId}` · `POST …/lock` | 잠그기 전 수정, 잠금 | post_launch |
| — | `POST /api/projects/{pid}/metric-cards/{cardId}/observations` | `{ successes, n }` 수동 관측 → 재검증 판정 | post_launch |
| `metric_card.export_yaml` / `export_csv` | `GET /api/projects/{pid}/tracking-plan?format=yaml\|csv` | 파일 | post_launch |
| — | `GET /api/projects/{pid}/cost-comparison` | 실제 AI 비용 vs 계산기 가정 | post_launch |
| `data_connection.add` | `POST /api/projects/{pid}/data-connections` | `{ tool_name, kind }` → `ingest_token` (한 번만 표시) | data_connections |
| `data_connection.remove` | `DELETE /api/projects/{pid}/data-connections/{connectionId}` | | data_connections |
| — | `POST /api/ingest` | 고객 도구가 보냄. `Authorization: Bearer vs_…` `{ type: "metric", event_name, metric_card_id?, successes, n, period_start, period_end }` (시각은 `2026-10-01T00:00:00+09:00`처럼 시간대를 붙여도 되고 `Z`도 된다) 또는 `{ type: "llm_cost", total_cost_krw, tasks, … }`. 같은 `event_name`의 잠근 카드가 여럿이면 `metric_card_id`가 필요하다 (없으면 409). 같은 기간의 비용을 두 번 보내면 409 | (서버 간) |
| `member.invite` | `POST /api/projects/{pid}/members` | `{ email, name, role: member\|external_rater }` | project_settings |
| `member.remove` | `DELETE /api/projects/{pid}/members/{memberId}` | | project_settings |
| `project.archive` / `project.restore` | `POST /api/projects/{pid}/archive` `{ reason }` / `POST …/restore` | | archive |

### 결과 제출 폼 (`input:evidence.*`)

```json
{
  "method_same": true,
  "method_diff_reason": "다르면 필수",
  "actual_method_key": "다른 실험 방법을 썼다면",
  "recruitment": "명부 무작위 추출",
  "attempts": 30,
  "responses": 28,
  "successes": 16,
  "clusters": 10,
  "cluster_successes": 6,
  "icc": 0.2,
  "raw_files": [{ "path": "…", "name": "결과.csv", "kind": "csv" }],
  "acquaintance_ratio": 0.1,
  "same_company_count": 1,
  "notice_given": true,
  "pilot_conditions": { "budget_owner_signed": true, "non_refundable_fee": true },
  "memo": ""
}
```

규칙: `successes ≤ responses ≤ attempts`. 같은 제안에 결과는 한 번만 (표본을 늘리려면 `verdict.rejudge`). 증거 수준·유효 표본·품질 경고(`quality_flags`)는 서버가 계산한다. L1(진술) 증거는 판정하지 않고 `verdict.judged = false`와 이유를 돌려준다.

## 화면별로 꼭 보여줄 서버 값

- 판정 (`verdict`): `result`, `p_above_target`, `p_below_min`, `wilson_low~wilson_high`, `n`(유효 표본), `raw_n`, `look_number`/4, `evidence_level`
- 기획서 (`proposal`): `sample_size`, `conclusion_probability`, `decision_table[{ n, metFrom, holdFrom, holdTo, failTo }]`, `locked_at`
- 가설 (`hypothesis`): `rank`, `criticality`, `critical_candidate`, `consensus.needsDiscussion`, `consensus.needsExternalRater`, `consensus.llmFlagReview`
- 진단 (`diagnosis`): `zone`, `is_provisional`(→ "잠정"), `wrapper_risk`, `demand_prior`(→ "참고용 추정, 판정에 쓰지 않음")

## 확장 API (2026-10-24 추가)

| 메서드·경로 | 본문 / 쿼리 | 화면 |
|---|---|---|
| `GET /api/projects/{pid}/review` | `{ cycle, warnings[], reviews[] }` 증거-계획 불일치 경고와 점검 주기 | dashboard |
| `POST /api/projects/{pid}/review` | `{ note }` 점검 기록 → 다음 점검일 다시 잡음 | dashboard |
| `GET /api/projects/{pid}` | 대시보드 응답에 `cycle`, `warnings[]` 추가 | dashboard |
| `PATCH /api/projects/{pid}` | `review_cycle_weeks`(1~12), `raw_retention_days`(7~3650) 추가 | project_settings |
| `PATCH /api/projects/{pid}/hypotheses/{hid}` | `diagnosis_id`, `diagnosis_axis: feasibility\|demand\|buyer_demand` 추가 → 판정이 나오면 진단 축·구역 자동 갱신 | hypotheses |
| `PATCH /api/projects/{pid}/diagnoses/{id}` | `buyer_demand` 축 추가 | diagnosis |
| `GET/POST /api/projects/{pid}/proposals/{id}/pitch` ⏳ | 판매 테스트용 피치·데모 초안 | proposal |
| `POST /api/projects/{pid}/integrations` | `{ provider: posthog\|amplitude\|langfuse, config }` 자격 증명 암호화 저장 + 연결 확인 | data_connections |
| `POST /api/projects/{pid}/integrations/sync` | `{ connection_id? }` 지금 가져와 재판정 | data_connections |
| `POST /api/projects/{pid}/data-connections/{id}/test` | 연결 확인 | data_connections |
| `PUT /api/projects/{pid}/metric-cards/{id}/source` | `{ source: { numerator_event, denominator_event, window_days } \| null }` | post_launch |
| `PATCH/DELETE /api/projects/{pid}/insights/{id}` | `{ confirmed, text?, code_type? }` 인사이트 확정 | results |
| `GET /api/projects/{pid}/raw-files` · `GET/DELETE …/raw-files/{id}` | 원자료 목록·내려받기·삭제 | files |
| `GET/POST /api/projects/{pid}/mentor-requests` · `DELETE …/{id}` | 외부 평가자 연결 요청 | hypotheses, settings |
| `GET /api/notifications` · `POST` | `{ ids[] }` 또는 `{ all: true }` 읽음 | notifications |
| `GET/PATCH/DELETE /api/account` · `GET /api/account/export` | 계정, `{ confirm: "계정 삭제" }`, JSON 내보내기 | account |
| `GET/POST /api/survey/price/{token}` | 공개 가격 설문 (로그인 없음) | price_survey |
| `GET/POST /api/cron/daily` | `Authorization: Bearer <CRON_SECRET>` | (예약 작업) |
| `/api/admin/*` | overview, cohorts, cohorts/{id}/teams, cohorts/{id}/offer, teams/{id}, price-surveys, cost, evals, evals/run(`LLM_PROVIDER=mock`일 때만, 실제 모델은 `npm run eval:sycophancy`), evals/baseline, evals/labels, coding, coding/compute, coding/{id}/next·labels·llm·segments(한 번에 약 4분, 남은 구간 수 `remaining`을 돌려줌), quality, mentors, mentor-requests/{id} | admin |

추가 오류 코드: `429 rate_limited`(요청 수 제한), `429 llm_budget_exceeded`(프로젝트 월 AI 사용 한도).
