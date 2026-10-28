# 검증실 — AI 스타트업 검증 서비스

AI 제품 아이디어에서 위험 가정을 찾고, "검증 실험 및 MVP 기획서"(PDF)를 만들고, 고객 팀이 낸 결과를 3갈래(충족 / 미달 / 판정 보류)로 판정하는 웹 서비스다. 화면과 API가 한 저장소(Next.js)에 있다.

## 가장 빨리 보기: 로컬 데모 모드

Supabase 없이 바로 돌려 볼 수 있다. 같은 마이그레이션과 예시 프로젝트를 메모리 안 Postgres(PGlite)에 올리고, LLM은 고정 응답(mock)을 쓴다. 서버를 끄면 데이터가 사라진다.

```bash
npm ci
npm run dev:demo        # http://localhost:3000 → 로그인 → "데모 사용자로 들어가기"
```

## 화면 디자인

화면 전체가 하나의 무대다. 검은 바닥, 화면 양쪽 아래에 고정된 회갈색 선화 구름, 무대 머리의 가는 광선과 네 갈래 별, 화면의 핵심 하나를 올린 기울어진 카드, 계산된 값만 보여주는 원형 게이지, 알약 버튼. 작업 패널은 구름과 같은 회갈색 판에 검은 선으로 그린다. 신호색은 의미에만 쓴다 (teal 충족·주요 동작, coral 미달, yellow 판정 보류, cyan 정보·진행). 토큰과 규칙은 `src/app/globals.css` 맨 위에 있다.

| 경로 | 화면 |
|---|---|
| `/` | 서비스 소개 (예시 프로젝트의 실제 판정을 무대에) |
| `/login` | 로그인·약관 동의 (데모: 버튼, 운영: 이메일 링크) |
| `/projects`, `/projects/new`, `/archive` | 프로젝트 목록, 생성, 보관함 |
| `/projects/{id}` | 대시보드 |
| `…/business-model`, `…/diagnosis`, `…/hypotheses` | 만들기 전 |
| `…/proposals`, `…/proposals/{pid}`, `…/results`, `…/verdicts`, `…/decisions` | 검증 |
| `…/settings`, `…/files`, `…/data` | 설정: 프로젝트, 원자료(가명 처리 사본), 데이터 연결 |
| `/evaluate/{token}` | 기준선 테스트 평가자 공개 화면 |
| `/survey/price/{token}` | 가격 설문 공개 화면 |
| `/notifications`, `/account` | 알림, 내 계정 |
| `/admin/*` | 운영자 화면 (`ADMIN_EMAILS`) |
| `/terms`, `/privacy` | 약관·개인정보 처리방침 초안 |

## 구성

```
src/lib/stats/        판정 규칙 (Jeffreys 3갈래, Wilson, 결정표, 결론 확률, 표본 크기, 군집 보정)
src/lib/cost/         AI 운영비 유닛 이코노믹스, 우리 서비스 가격 하한·손익분기, Van Westendorp
src/lib/domain/       판정·진단 규칙 (증거 수준, 4구역, 대체 위험, 중요도 합의, 권고), 실험 목록
src/lib/llm/          LLM 호출 (JSON 스키마 고정, 호출 기록, mock), 프롬프트, 인용 검증
src/lib/pii/          가명 처리 (이메일·전화·주민번호·사업자번호·이름·회사)
src/lib/services/     화면별 로직
src/lib/pdf/          기획서 PDF (Noto Sans KR)
src/app/api/          API 라우트 (action 키와 1:1)
src/app/              화면 (App Router)
src/components/       무대, 기울어진 카드, 원형 게이지, 배지, 프로젝트 틀
src/lib/dev/          로컬 데모 모드 (PGlite + 흉내 Supabase 클라이언트)
src/lib/integrations/ PostHog·Amplitude·Langfuse 가져오기 어댑터
src/lib/crypto/       연동 자격 증명 암호화 (AES-256-GCM)
src/lib/reliability/  Krippendorff α, Cohen κ, 자동 적용 판정
src/lib/eval/         아첨 점검 세트(가상 아이디어 32개, 심은 약점 45개, 반박 60회)와 실행기
src/lib/services/admin/ 운영자: 성공 기준, 가격·비용, 품질 보고
scripts/              setup, doctor, eval:sycophancy, predeploy:check, workbank:import, smoke
supabase/migrations/  스키마, 규칙 트리거, RLS, 저장소, 0005 보안·정합성 강화, 0006 저장소 직접 접근 차단, 0007 동시 요청·중복 계정 정리
supabase/seed.sql     예시 프로젝트 (scripts/generate-seed.ts로 생성)
tests/unit/           판정·비용·규칙·LLM·가명 처리 (기획 문서 수치와 대조)
tests/db/             마이그레이션·트리거·RLS (PGlite로 실제 실행)
tests/integration/    화면 순서대로 서비스 전체 흐름 (PGlite + mock LLM)
```

원칙 (기획 문서 그대로):
- LLM은 점수·판정을 내지 않는다. 가정 추출, 근거 정리, 기획서 초안만 쓴다.
- 숫자(비용, 표본 크기, 신뢰구간, 판정)는 전부 코드로 계산한다.
- 목표값·최소 허용치는 제안 시점에 잠그고, DB 트리거로도 변경을 막는다.
- 판정·증거 수준·가설 상태는 서버만 쓴다.
- 브라우저는 DB·저장소에 직접 닿지 않는다. 모든 읽기·쓰기는 API 라우트가 권한을 확인한 뒤 service role로 한다 (`anon`·`authenticated` 역할의 테이블·함수 권한을 모두 회수, RLS는 2차 방어선으로 남김). 파일도 API를 거쳐 내려받는다.
- 재판정은 처음 판정을 포함해 최대 4회.

## 키만 넣으면 도는 순서 (운영)

```bash
npm ci
cp .env.example .env.local     # 아래 "넣을 값"을 채운다
npm run setup                  # DB에 마이그레이션·예시 프로젝트를 넣고 저장소 버킷을 확인 (여러 번 실행해도 안전)
npm run doctor                 # 키·연결·스키마 점검. ✗가 없으면 끝
npm run dev                    # 또는 npm run build && npm start
```

### 넣을 값 (.env.local)

| 변수 | 어디서 | 필수 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API | 필수 |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (URI, 세션 모드 5432) | `npm run setup` 때만 |
| `ANTHROPIC_API_KEY` | console.anthropic.com | 필수 (`LLM_PROVIDER=anthropic`) |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | 필수 (도구 연동 자격 증명 암호화) |
| `ADMIN_EMAILS` | 운영자 이메일, 쉼표로 구분 | 운영자 화면을 쓰려면 |
| `CRON_SECRET` | 아무 긴 문자열 | 매일 예약 작업을 쓰려면 |
| `APP_URL` | 배포 주소 | 필수 |
| `RESEND_API_KEY`, `MAIL_FROM` | resend.com (보내는 도메인 인증) | 선택: 알림 메일 |
| `VOYAGE_API_KEY` | voyageai.com | 선택: WORKBank 수요 사전값 |
| `BASELINE_INPUT_PRICE_PER_MTOK_KRW`, `BASELINE_OUTPUT_PRICE_PER_MTOK_KRW` | 기준선 테스트 모델(`BASELINE_MODEL`) 단가 | 선택 (기본 1400·7000원) |

`npm run setup`과 `npm run db:push`(Supabase CLI)는 둘 중 하나만 쓰면 된다. setup은 적용한 마이그레이션을 CLI 기록 테이블(`supabase_migrations.schema_migrations`)에도 남기므로, 나중에 CLI로 바꿔도 같은 마이그레이션을 두 번 넣지 않는다. 이미 앞 번호를 넣은 DB라면 setup을 다시 돌리면 새 번호(0005~0007)만 들어간다. 예전 규칙에서 생길 수 있던 중복(같은 제안의 결과 두 개, 대소문자만 다른 초대, 같은 기간 비용)은 0005가 먼저 정리한다. `npm run doctor`의 "마이그레이션 최신"이 ✓면 끝.

빈 값(`KEY=`)은 넣지 않은 것으로 본다. 선택 기능 키(`ENCRYPTION_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `VOYAGE_API_KEY`, `MAIL_FROM`, `USD_KRW`)의 형식이 틀리면 앱 전체가 멈추지 않고 그 기능만 꺼진다 (서버 로그에 경고). `npm run doctor`가 어떤 키가 틀렸는지 알려 준다.

Supabase 대시보드에서 한 번 더: Authentication → URL Configuration → Site URL = 배포 주소, Redirect URLs에 `https://<배포 주소>/auth/callback` 추가 (`npm run setup` 마지막에 같은 안내가 나온다). Authentication → Providers → Email의 **Confirm email은 켜 둔다**: 팀 초대는 메일 인증을 마친 계정에만 연결되는데, 이 설정을 끄면 초대받은 메일로 누구나 먼저 가입해 연결될 수 있다.

### 매일 예약 작업 (`/api/cron/daily`)

PostHog·Amplitude·Langfuse에서 값을 가져와 같은 3갈래 규칙으로 재판정하고, 점검일·예상 기간이 지난 제안을 알리고, 보관 기간이 지난 원자료를 지운다.

한 번에 약 4분 안에 끝나도록 나눠서 한다: 원자료 삭제 → 알림 → 오래된 요청 제한 기록 정리 → 연동 동기화(가장 오래 전에 가져온 연결부터, 4개씩 동시에). 시간 안에 못 끝낸 연결은 응답의 `deferred`에 세어지고 다음 날 먼저 처리된다. 연동 주소는 공개 https 주소만 받는다 (내부망·localhost 차단).

- **Vercel**: `vercel.json`에 매일 03:00(한국 시간)로 들어 있다. 프로젝트 환경 변수에 `CRON_SECRET`만 넣으면 된다.
- **다른 서버**: `crontab`에 `0 3 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<배포 주소>/api/cron/daily`

### 운영자가 처음 한 번 할 일

1. `npm run workbank:import` (선택, `VOYAGE_API_KEY` 필요): Hugging Face에서 WORKBank를 내려받아 임베딩해 넣는다. 비상업적 용도, 유료 판매 전 저자 허락.
2. `npm run eval:sycophancy`: 아첨 점검 3종을 실제 모델로 돌린다 (약 300회 호출, 웹 요청 시간 제한에 걸리지 않도록 스크립트로만 돈다. 운영자 화면의 "실행 (mock)" 버튼은 `LLM_PROVIDER=mock`일 때만 보인다). 그다음 운영자 화면 → 아첨 점검에서
   - 전문가 2인 평균 탐지율을 넣고
   - 채점기 검증용 사람 라벨을 약점 탐지·반박 각각 150개 이상 단다 (Cohen κ ≥ 0.65)
3. `npm run predeploy:check`: 지금 프롬프트·모델로 3종이 모두 통과했는지 확인한다. 못 넘으면 배포하지 않는다 (CI에도 같은 작업이 있다). 프롬프트·모델을 바꾸면 지문이 바뀌어 다시 돌려야 한다.
4. 운영자 화면 → 코딩 일치도: 내부 검증 세트를 넣고 LLM·사람이 따로 코딩해 코드 유형별 α를 계산한다. 그 전까지 고객 전사본의 인사이트는 모두 사람이 확정한다.
5. 모델 단가표(`price_table`)를 월 1회 갱신한다.

## 기능 지도

| 화면 | 하는 일 |
|---|---|
| 대시보드 | 다음 할 일, **증거-계획 불일치 경고**(치명 가설 미검증인데 계속, 판정과 반대인 결정, 사업 모델 변경 뒤 옛 판정, 예상 기간 초과, 실무자·구매자 수요 엇갈림 등), **점검 주기와 점검 기록** |
| 사업 모델 | Lean Canvas 버전, 변형 비교, **업무 목록 편집** |
| 진단 | 4구역, 축별 판정(가능성·실무자 수요·구매자 수요)이 **연결된 가설의 판정으로 자동 갱신** |
| 가설 | 사전 부검, 독립 평정, 반대 평가자, **고치기·지우기·진단 축 연결**, **제휴 멘토 연결 요청** |
| 검증 제안 | 기획서 PDF, 기준 잠금, **실행 가이드 문구 편집**, **판매 테스트용 피치·데모 초안**, **실사용 지표(출시 뒤에도 같은 틀: 분자·분모 이벤트와 측정 기간을 기준과 함께 잠금)** |
| 결과 수령 | 결과 제출 폼, 전사본 분석, **해석형·미검증 코드 인사이트 확정**, 실사용 지표 직접 입력 |
| 데이터 연결 | **PostHog·Amplitude·Langfuse API 키 연결(암호화 저장)·확인·지금 가져오기**, 수신 토큰, 추적 계획 내보내기. 측정 기간이 끝난 실사용 지표는 결과로 자동 제출·판정, 실제 AI 비용은 진단의 운영비 계산기 아래에 |
| 원자료 | **가명 처리한 원자료 목록·내려받기·삭제, 보관 기간 자동 삭제** |
| 프로젝트 설정 | 팀원·외부 평가자, **점검 주기, 원자료 보관 기간**, 멘토 요청 현황 |
| 알림 | 미달 판정, 점검일, 예상 기간 초과, 멘토 배정 (화면 + 선택적 메일) |
| 내 계정 | 이름·메일 알림, **내 기록 JSON 내려받기, 계정 삭제** |
| 운영자 (`/admin`) | 개요(배포 전 점검 상태·설정), **성공 기준 기수 누적 판정**, **가격 설문(Van Westendorp 공개 링크)·우리 비용 구조(가격 하한·손익분기)**, **아첨 점검 실행·채점기 라벨**, **코딩 일치도(α)**, **중요도 척도 α·예측 타당도·설계 가정 추적**, **제휴 멘토 관리·배정** |
| `/terms`, `/privacy` | 약관·개인정보 처리방침 (법률 검토 전 초안) |

보호 장치: 공개 주소(평가 링크·가격 설문·수신 주소)와 LLM 호출에 요청 수 제한, 프로젝트당 월 AI 사용 한도(`PROJECT_MONTHLY_LLM_BUDGET_KRW`). 요청 수 제한은 DB 오류가 나면 막지 않고 통과시킨다(가용성 우선). 팀 초대는 메일 인증을 마친 계정에만 연결되고, 운영자(`ADMIN_EMAILS`)도 메일 인증을 마친 계정만 인정한다.

## 개발·테스트

```bash
npm run dev:demo                # Supabase 없이 (PGlite + mock LLM). 데모 사용자는 운영자 화면도 열린다
npm test                        # 단위 테스트 (판정·비용·규칙·LLM·가명 처리·일치도)
npm run test:db                 # 마이그레이션·규칙 트리거·브라우저 역할 차단 (DB 서버 없이 PGlite)
npm run test:integration        # 서비스 전체 흐름 + 확장 기능 (PGlite + mock LLM)
```

## 서버에 올리기

### 앱 서버 — 둘 중 하나

**Vercel** (가장 간단)
1. 저장소를 Vercel에 연결, 리전 `icn1`(서울, `vercel.json`에 들어 있음)
2. Environment Variables에 `.env.local`의 값 입력 (`DATABASE_URL`은 넣지 않아도 된다)
3. 배포. LLM 호출 라우트는 최대 300초가 필요하므로 Pro 플랜이 필요할 수 있다 (`maxDuration`)

**Docker** (어느 서버든)
```bash
docker build -t ai-startup-validation .
docker run -d -p 3000:3000 --env-file .env.local --restart unless-stopped ai-startup-validation
```
앞단에 HTTPS 리버스 프록시(Caddy, Nginx 등)를 둔다. 요청 수 제한은 `X-Forwarded-For`의 마지막 값(프록시가 붙인 접속 주소)으로 사람을 구분하므로, 프록시가 이 헤더를 붙이게 한다 (Caddy는 기본, Nginx는 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). 앱 포트(3000)는 밖에 직접 열지 않는다. 헬스체크: `GET /api/health`. 예약 작업은 위 crontab 줄을 쓴다.

### 배포 확인

```bash
npm run doctor
APP_URL=https://<배포 주소> npm run smoke
```
smoke는 임시 사용자를 만들어 프로젝트 생성 → 가설 → 기획서 → 잠금 → PDF → 결과 제출 → 판정 → 결정 → 추적 계획까지 돌고 지운다.

## CI

GitHub Actions 설정은 `ci/github-actions-ci.yml`에 있다. 저장소에 올릴 때 `.github/workflows/ci.yml`로 옮긴다 (타입 검사, 단위·DB·통합 테스트, 빌드).

## 예시 프로젝트

id `00000000-0000-4000-8000-000000000001` (가상 사례, 읽기 전용, 로그인 없이 열람). 숫자는 서비스와 같은 코드로 계산해 `npm run seed:generate`로 다시 만든다.

## 출시 전 남은 일 (코드 밖)

- 약관·위탁 관계 법률 검토 (결정 사항 5번) → `/terms`, `/privacy` 초안을 고치고 `TERMS_VERSION`을 올린다
- 아첨 점검: 전문가 2인 평가와 채점기 사람 라벨 (위 "운영자가 처음 한 번 할 일")
- 코딩 일치도: 코드 유형마다 구간 104개 이상 사람 코딩
- WORKBank 상업적 사용 허락 (유료 판매 전)

## 라이선스 고지

- 한국어 폰트: Noto Sans KR, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`)
- WORKBank: Shao et al., "Future of Work with AI Agents" — 라이선스 표기 없음, 비상업적 용도
