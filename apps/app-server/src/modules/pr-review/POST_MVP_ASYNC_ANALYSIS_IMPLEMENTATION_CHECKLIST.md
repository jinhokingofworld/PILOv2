# PR Review Post-MVP 비동기 AI 분석 구현 체크리스트

이 문서는 PR Review Post-MVP의 `Async AI Analysis Pipeline`을 작은 PR 단위로
안전하게 구현하기 위한 진행 체크리스트다. 방향과 우선순위는 `POST_MVP.md`, API
계약은 `docs/api/pr-review-api.md`를 기준으로 한다.

## 목표

- Review Session 생성 요청이 OpenAI 분석 완료를 기다리지 않고 빠르게 끝난다.
- 분석 Job은 유실되지 않으며 같은 Job이 다시 전달되어도 결과가 중복 생성되지 않는다.
- AI Worker가 PR 분석을 수행하고 결과를 기존 PR Review 데이터 모델에 반영한다.
- 분석 중 PR head SHA가 바뀌면 오래된 결과를 현재 세션에 덮어쓰지 않는다.
- 사용자는 `analyzing`, `reviewing`, `failed` 상태와 재시도 결과를 화면에서 이해할 수 있다.

## 현재 구현 기준선

- `POST /review-sessions`는 PR 상세, 변경 파일, conflict 상태를 조회하고 OpenAI 분석까지
  요청 안에서 수행한 뒤 `reviewing` 세션을 반환한다.
- `pr_review_sessions.status`에는 이미 `analyzing`, `reviewing`, `failed`가 존재한다.
- PR Review 전용 Job, outbox, 재시도 횟수, 실패 사유 저장소는 아직 없다.
- AI Worker의 현재 dispatcher는 `meeting_report`, `agent_run_requested`만 처리한다.
- Frontend는 세션 생성 응답을 받으면 즉시 Review room을 열며 분석 진행/실패 전용 화면은 없다.
- 배포 환경에는 AI Job SQS와 DLQ가 있지만 PR Review Job의 큐 배치 정책은 정해지지 않았다.

## 진행 원칙

- 각 PR은 아래 Phase slice 하나만 다룬다.
- API 계약 변경은 코드와 `docs/api/pr-review-api.md`를 같은 PR에서 수정한다.
- DB 변경은 새 migration으로만 추가하고 DB Schema 담당자 확인 후 반영한다.
- App Server와 AI Worker 사이 payload는 식별자 중심으로 유지하고 PR patch 전체를 SQS
  message에 직접 넣지 않는다.
- 세션 생성과 Job 발행 사이에 Job이 유실되지 않도록 durable delivery를 기본 방향으로 한다.
- AI 분석 실패는 deterministic fallback으로 성공처럼 숨기지 않고, 확정된 재시도 정책이
  소진되면 안전한 reason code와 함께 `failed`로 끝낸다.
- 구현 선택지가 생기면 해당 Phase의 Stop Gate에서 멈추고 결정 후 진행한다.

## Phase 추적

| Phase | 목적 | Issue | PR | 상태 |
| --- | --- | --- | --- | --- |
| 2-A | Scope, API, 상태 전이와 Worker 경계 확정 | #652 | #658 | 완료 |
| 2-B | `analyzing` 세션 생성과 durable Job enqueue | #659 | #664 | 완료 |
| 2-C | AI Worker PR 분석 processor | #666 | #668 | 완료 |
| 2-D | 분석 결과 원자 저장과 stale/idempotency guard | #670 | #699 | 진행 |
| 2-E | Review room 분석 진행/실패/retry UX | #703 | TBD | 진행 |
| 2-F | 운영 복구, 관측성, 배포 검증 | TBD | TBD | 대기 |

## 공통 Stop Gate

아래 항목 중 하나라도 해당하면 구현 전에 멈추고 확인받는다.

- API endpoint, request, response, status code, auth rule 변경
- DB table, column, check constraint, FK, index, RLS 변경
- PR Review 전용 큐 추가 또는 기존 큐 공유 정책 변경
- App Server와 AI Worker 사이 payload/internal API 계약 추가
- OpenAI prompt, structured output schema, model 또는 fallback 정책 변경
- retry 횟수, DLQ, 사용자 재시도 정책 변경
- GitHub Integration 공개 API 또는 내부 dependency 경계 변경
- App Server, Frontend, Infra/Realtime 공통 영역 변경
- 기존 Conflict suggestion의 동기 호출 방식까지 함께 변경하려는 경우

## 2-A Scope, Contract, State Machine

목표:

- 비동기 분석의 API 응답, 상태 전이, Job 경계와 실패 정책을 구현 전에 확정한다.

결정 체크리스트:

- [x] 세션 생성 성공 HTTP status는 기존 `201 Created`를 유지한다. 같은 사용자·PR의
  진행 중 중복 요청은 기존 `analyzing` session을 `200 OK`로 반환한다.
- [x] 생성 응답은 `status: analyzing`인 최소 session을 즉시 반환한다. 분석 결과 필드는
  `null` 또는 빈 배열이며 `totalFileCount`는 0이다.
- [x] 상태 전이는 `analyzing -> reviewing`, `analyzing -> failed`만 허용한다. 완전한 결과
  graph/file 저장 transaction의 마지막 단계에서만 `reviewing`으로 전환한다.
- [x] `POST /review-sessions/{reviewSessionId}/retry`는 `failed`에서만 허용하고 새 session과
  새 job을 `201 Created`로 만든다. 기존 failed session은 변경하지 않는다.
- [x] head SHA가 바뀌면 flow/file을 쓰지 않고 `failed(PR_HEAD_CHANGED)`로 끝낸다.
- [x] OpenAI 오류는 deterministic fallback으로 `reviewing`을 만들지 않는다. outbox 또는
  Worker 재시도 소진 뒤 안전한 failure code와 함께 `failed`로 끝낸다.
- [x] conflict 상태 조회는 생성 요청에 남긴다. 변경 파일/patch와 AI 분석은 Worker 경계로
  이동하며 conflict suggestion의 동기 방식은 유지한다.
- [x] Worker는 인증된 App Server internal handoff로 PR detail·변경 파일·patch를 조회한다.
  SQS payload에는 식별자만 넣고 snapshot/patch를 저장하거나 전달하지 않는다.
- [x] PR Review Job은 전용 SQS와 DLQ, 동일 image 기반의 별도 ECS worker service를 사용한다.
  기존 Meeting/Agent queue와 worker는 공유하지 않는다.
- [x] Worker는 DB에 직접 결과를 기록하지 않고 App Server internal result/failure endpoint로
  완료를 전달한다. App Server가 head SHA 재검증과 원자 저장을 담당한다.
- [x] Worker는 기존 `pr_review_analysis` strict JSON schema와 `gpt-5.1-mini` 기본 모델을
  유지한다. PR body 4,000자, file patch별 4,000자, 전체 patch 32,000자, 60초 timeout을
  사용하며 invalid output에는 fallback 대신 terminal failure를 적용한다.
- [x] Frontend 갱신은 polling으로 시작하고 realtime은 후속 범위로 둔다.
- [x] 세션과 outbox intent는 같은 DB transaction에 저장한다. payload schema는
  `pr-review-analysis:v1`로 시작한다.
- [x] `docs/api/pr-review-api.md`와 `POST_MVP.md`에 최종 계약을 반영한다.

### 확정 상태 전이와 재시도

| 시작 상태 | 사건 | 종료 상태 | 저장/사용자 동작 |
| --- | --- | --- | --- |
| 없음 | session·outbox transaction commit | `analyzing` | `201 Created` 최소 session 반환 |
| `analyzing` | outbox 발행 실패 | `analyzing` | 1, 2, 4, 8, 16분 간격으로 최대 5회 재시도 |
| `analyzing` | outbox 발행 재시도 소진 | `failed` | `ANALYSIS_ENQUEUE_FAILED` 저장 |
| `analyzing` | Worker provider/handoff 일시 실패 | `analyzing` | SQS receive count 3회까지 재시도 |
| `analyzing` | Worker 재시도 소진 | `failed` | `ANALYSIS_PROVIDER_FAILED` 저장 |
| `analyzing` | invalid input/output | `failed` | `ANALYSIS_INPUT_INVALID` 저장, 메시지 terminal 처리 |
| `analyzing` | current GitHub head SHA 불일치 | `failed` | `PR_HEAD_CHANGED` 저장, graph/file 저장 금지 |
| `analyzing` | 유효한 분석 결과 원자 저장 | `reviewing` | graph/file 저장 후 마지막에 status 전환 |
| `failed` | 사용자 retry | 새 `analyzing` session | 기존 session 보존, 새 job/outbox 생성 |
| `reviewing` | 같은 job 재전달 | `reviewing` | 완료 결과 인정, 중복 row 생성 금지 |

### 확정 Worker 경계

- SQS: `pr_review_analysis_requested`, `pr-review-analysis:v1`, `jobId`, `reviewSessionId`,
  `workspaceId`, `headSha`만 전달한다.
- 인프라: PR Review 전용 SQS/DLQ와 해당 queue만 polling하는 별도 ECS worker service를 둔다.
  기존 AI Worker Docker image를 재사용할 수 있지만, 실행 task는 분리한다.
- 입력: Worker는 internal input endpoint에서 PR detail·변경 파일·patch를 받는다.
- 완료: Worker는 normalized analysis 또는 safe failure code를 internal endpoint로 전달한다.
  App Server가 현재 head SHA 비교와 DB transaction을 수행한다.
- 인증: 모든 internal handoff는 `X-Pr-Review-Analysis-Worker-Token`과
  `PR_REVIEW_ANALYSIS_WORKER_TOKEN`으로 인증한다.
- OpenAI: Responses API strict JSON schema `pr_review_analysis`,
  `OPENAI_PR_REVIEW_MODEL`(기본 `gpt-5.1-mini`), 60초 timeout을 사용한다.
- 보안: SQS, 로그, 사용자 API 응답에 patch, OAuth token, provider raw error를 남기지 않는다.

완료 기준:

- [x] 구현자가 임의로 선택해야 하는 API/DB/Worker 경계가 남아 있지 않다.
- [x] 정상, retry, terminal failure, stale head의 상태 전이 표가 문서화돼 있다.
- [x] 예상 PR 분할과 각 PR의 API/DB/배포 영향이 기록돼 있다.

## 2-B Analyzing Session and Durable Enqueue

목표:

- 세션 생성과 Job 발행 사이 유실 구간 없이 `analyzing` 세션을 빠르게 반환한다.

작업 체크리스트:

- [x] `pr_review_analysis_jobs` migration을 추가한다. 이 단일 table은 job identity와 durable
  outbox 발행 상태를 함께 보관한다.
- [x] session당 job 하나의 unique constraint와 같은 사용자·PR의 `analyzing` session partial
  unique index로 중복을 막는다.
- [x] `analyzing` session row와 `pending` job row를 같은 transaction에서 생성한다.
- [x] 분석 결과/flow/file이 없는 `analyzing` session을 repository와 API payload가 허용한다.
- [x] job publisher가 claim token과 `FOR UPDATE SKIP LOCKED`로 중복 발행을 방지한다.
- [x] 1, 2, 4, 8, 16분 간격의 5회 재시도와 terminal publish failure 처리를 구현한다.
- [x] SQS 발행 성공 뒤 job 상태를 `queued`로 원자 갱신한다.
- [x] 서버 시작과 60초 sweep에서 `pending`/stale `publishing` job을 회수한다.
- [x] 같은 사용자·PR의 중복 요청은 기존 `analyzing` session을 `200 OK`로 반환한다.
- [x] `pr_review_analysis_requested` / `pr-review-analysis:v1` 식별자 payload만 SQS에 보낸다.
- [x] publish 재시도 소진 시 job과 session을 `ANALYSIS_ENQUEUE_FAILED`로 terminal 처리한다.

완료 기준:

- [x] OpenAI 호출 지연과 무관하게 세션 생성 응답이 반환된다.
- [x] DB commit 직후 App Server가 종료돼도 Job intent가 남아 다시 발행된다.
- [x] publisher가 같은 outbox row를 동시에 처리해도 SQS 발행 상태가 일관된다.
- [x] token, secret, 전체 patch가 payload나 로그에 노출되지 않는다.

## 2-C AI Worker PR Analysis Processor

목표:

- AI Worker가 versioned PR Review Job을 검증하고 분석 결과 초안을 생성한다.

작업 체크리스트:

- [x] `pr_review_analysis_requested` Job type과 payload parser를 추가한다.
- [x] dispatcher가 PR Review processor로 Job을 전달하도록 확장한다.
- [x] 존재하지 않거나 이미 terminal 상태인 session의 처리 규칙을 구현한다.
- [x] 분석 입력을 확정된 App Server/DB 경계에서 조회한다.
- [x] Job의 `headSha`와 분석 입력 snapshot의 head SHA가 일치하는지 확인한다.
- [x] 현재 TypeScript 분석의 prompt budget, structured output schema, normalization 규칙을
  Worker 구현으로 옮기거나 공유 가능한 계약으로 고정한다.
- [x] 파일 누락, 중복 file path, 잘못된 risk level과 빈 핵심 필드를 검증한다.
- [x] timeout, rate limit, provider 5xx를 retryable infrastructure failure로 분류한다.
- [x] 잘못된 payload/schema와 존재하지 않는 resource를 non-retryable failure로 분류한다.
- [x] OpenAI model/env를 AI Worker 배포 환경에 명시한다.
- [x] 로그에는 job ID, session ID, reason code만 남기고 PR 코드와 provider 원문은 남기지 않는다.

완료 기준:

- [x] 정상 Job은 검증된 분석 결과를 다음 저장 단계로 전달한다.
- [x] retryable failure는 SQS 재수신 대상으로 남는다.
- [x] non-retryable failure는 무한 재시도 없이 terminal 처리된다.
- [x] 동일 Job을 여러 번 받아도 새 분석 결과를 중복 확정하지 않는다.

## 2-D Atomic Result Persistence and Guards

> Tracking: Issue #670, PR #699. Result/failure handoff, stale head terminalization, atomic graph persistence, and duplicate delivery handling are implemented in this slice.

목표:

- 분석 결과를 session, flow, file 관계에 한 번만 원자적으로 반영한다.

작업 체크리스트:

- [x] 결과 저장 전에 session 상태가 여전히 `analyzing`인지 확인한다.
- [x] Job head SHA, session head SHA와 현재 GitHub PR head SHA를 비교한다.
- [x] stale Job은 flow/file을 쓰지 않고 확정된 실패 또는 재생성 안내 상태로 끝낸다.
- [x] session summary, review flow, review files, flow-file 관계를 한 transaction에 저장한다.
- [x] 모든 결과 저장이 끝난 뒤 마지막에 session을 `reviewing`으로 전환한다.
- [x] 중간 실패 시 일부 flow/file만 남지 않도록 rollback을 검증한다.
- [x] 같은 Job 재전달 시 기존 완료 결과를 그대로 인정하고 중복 row를 만들지 않는다.
- [x] 재시도 횟수 소진 시 session을 `failed`로 전환하고 안전한 reason code를 저장한다.
- [x] 사용자 노출 메시지와 운영 로그용 상세 오류를 분리한다.
- [x] 완료/실패 처리 후 outbox 또는 Job execution 상태를 terminal로 갱신한다.

완료 기준:

- [x] `reviewing` session에는 완전한 graph/file 데이터만 존재한다.
- [x] `failed` session에는 부분 graph가 사용자에게 노출되지 않는다.
- [x] stale 분석 결과가 새 head SHA 세션을 덮어쓰지 않는다.
- [x] SQS at-least-once 전달에서도 결과가 한 번만 확정된다.

## 2-E Frontend Analysis Status UX

> Tracking: Issue #703. 2초 polling, 5분 분석 지연 안내, 완료/실패 전환과 retry UX를 이 slice에서 구현한다.

목표:

- 사용자가 분석 진행, 완료, 실패와 다음 행동을 Review room에서 알 수 있다.

작업 체크리스트:

- [x] 세션 생성 응답이 `analyzing`이면 분석 대기 화면으로 진입한다.
- [x] 대기 화면에서 PR 제목/브랜치와 분석 중 상태를 보여준다.
- [x] 확정된 간격과 최대 시간으로 session 상태를 polling한다.
- [x] `reviewing` 전환 후 summary/canvas를 한 번만 불러와 Review room을 연다.
- [x] `failed` 상태에서 안전한 오류 메시지와 재시도 action을 제공한다.
- [x] stale head 실패는 GitHub 동기화/새 세션 생성 등 실제 다음 행동을 안내한다.
- [x] polling 네트워크 오류와 분석 자체 실패를 구분한다.
- [x] 화면 이탈/unmount 시 polling과 진행 중 요청을 취소한다.
- [x] 중복 탭/중복 클릭이 새 Job을 불필요하게 만들지 않게 한다.
- [x] 새로고침 후에도 session 상태 조회로 진행 화면을 복구한다.
- [x] 로딩 UI가 빈 canvas 또는 일반 Internal server error로 보이지 않게 한다.

완료 기준:

- [x] 사용자는 세션 생성 직후 request timeout 없이 분석 진행 상태를 본다.
- [x] 분석 완료 시 별도 수동 새로고침 없이 Review room이 열린다.
- [x] 실패 시 원인 범주와 가능한 다음 행동을 확인할 수 있다.
- [x] polling이 완료/실패/화면 이탈 후 남지 않는다.

## 2-F Recovery, Observability, and Deployment

목표:

- 장애와 재배포 상황에서 Job을 복구하고 운영자가 상태를 추적할 수 있게 한다.

작업 체크리스트:

- [ ] SQS visibility timeout이 PR Review 분석 최대 처리 시간보다 긴지 확인한다.
- [ ] DLQ redrive max receive count와 application terminalization 시점을 일치시킨다.
- [ ] 오래 `analyzing`인 session과 stale execution을 복구하는 sweep을 구현한다.
- [ ] pending/publishing/processing/succeeded/failed 수를 추적할 운영 지표를 정의한다.
- [ ] 로그에 job ID와 session ID correlation을 적용한다.
- [ ] AI Worker health가 processor 초기화 실패를 감지하는지 확인한다.
- [ ] App Server와 AI Worker의 env/secrets/model 설정을 문서화한다.
- [ ] queue 또는 ECS service 변경 시 Terraform, IAM, 배포 workflow를 함께 반영한다.
- [ ] dev 배포에서 enqueue, consume, DB 반영, Frontend 전환을 end-to-end로 확인한다.
- [ ] DLQ 또는 terminal failure session을 운영자가 재처리하는 절차를 문서화한다.

완료 기준:

- [ ] App Server/AI Worker 재시작 중에도 Job이 유실되지 않는다.
- [ ] retry 소진 Job이 무한 처리되지 않고 사용자 session도 terminal 상태가 된다.
- [ ] 운영자가 session ID로 enqueue부터 완료/실패까지 추적할 수 있다.
- [ ] 배포 환경에서 대용량 PR이 HTTP timeout 없이 분석된다.

## 권장 PR 분할

1. `2-A`: 결정 기록과 API 계약
2. `2-B`: migration, outbox, 세션 생성/enqueue
3. `2-C`: AI Worker processor와 dispatcher
4. `2-D`: 결과 저장, idempotency, stale/retry terminalization
5. `2-E`: Frontend 진행/실패/retry UX
6. `2-F`: 운영 복구, 인프라와 end-to-end 검증

API 계약과 DB schema가 동시에 확정되어야 하는 경우에도 구현 PR은 가능한 한 위 경계를
유지한다. 공통 영역이나 Terraform 변경이 포함되는 PR은 사이렌 변경으로 표시하고 관련
담당자에게 공유한다.

## 검증 체크리스트

### App Server

- [ ] 세션과 outbox intent가 같은 transaction에 저장된다.
- [ ] publish 실패/재시작 복구/동시 claim 테스트가 통과한다.
- [ ] stale head와 중복 Job 저장 테스트가 통과한다.
- [ ] `format:check`, `lint`, `build`, PR Review focused test가 통과한다.

### AI Worker

- [ ] payload validation과 dispatcher routing 테스트가 통과한다.
- [ ] provider 성공, timeout, rate limit, invalid output 테스트가 통과한다.
- [ ] retryable/non-retryable 분류와 receive count 소진 테스트가 통과한다.
- [ ] Python format/lint/test와 image build가 통과한다.

### Frontend

- [ ] analyzing polling, reviewing 전환, failed/retry 테스트가 통과한다.
- [ ] 새로고침, 화면 이탈과 polling 취소를 확인한다.
- [ ] `format:check`, `lint`, `build`, PR Review focused test가 통과한다.

### 통합

- [ ] 동일 Job 중복 전달에도 flow/file이 중복 생성되지 않는다.
- [ ] 분석 중 head SHA 변경 시 오래된 결과가 저장되지 않는다.
- [ ] App Server와 Worker 재시작 뒤 pending Job이 완료된다.
- [ ] DLQ/terminal failure와 사용자 `failed` 상태가 일치한다.
- [ ] secret, token, 전체 patch, provider raw error가 응답/로그에 노출되지 않는다.

## PR 생성 전 확인

- [ ] `AGENTS.md`, `convention.md`, `coding-rule.md`를 확인했다.
- [ ] `docs/api/README.md`, `docs/api/pr-review-api.md`를 확인했다.
- [ ] `apps/frontend/FRONTEND_COMMON_AREAS.md`를 확인했다.
- [ ] `apps/app-server/APP_SERVER_COMMON_AREAS.md`를 확인했다.
- [ ] API 계약, DB schema, Infra/env, 공통 영역 변경 여부를 PR 본문에 적었다.
- [ ] 관련 도메인/DB Schema/Infra 담당자 확인이 필요한 변경을 명시했다.
- [ ] 실행한 검증과 미수행 검증의 사유를 PR 본문에 적었다.
