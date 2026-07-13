# PR Review 비동기 분석 운영 추적

## 목적

PR Review session 생성부터 전용 Worker 분석 완료 또는 실패까지를 `session_id`와
`job_id`로 추적하고, terminal failure가 발생했을 때 원본 기록을 훼손하지 않고 새 분석을
시작한다. PR patch, OAuth token, OpenAI 원문 오류와 secret은 로그나 운영 기록에 남기지 않는다.
대신 단계, 안전한 오류 타입, HTTP 상태, provider request ID와 소요 시간을 기록한다.

## Correlation 키

| 키 | 의미 | 확인 위치 |
| --- | --- | --- |
| `session_id` | 사용자가 시작한 PR Review 분석 단위 | API URL, `pr_review_sessions`, App Server·Worker 로그 |
| `job_id` | durable publish 및 Worker 처리 단위 | `pr_review_analysis_jobs`, App Server·Worker 로그 |
| `head_sha` | 분석 입력과 결과가 같은 PR head인지 확인하는 기준 | session/job row, GitHub PR |

## 상태 흐름

정상 흐름은 `pending -> publishing -> queued -> processing -> succeeded`다. session은 Job
생성 시 `analyzing`이고 결과가 원자 저장된 뒤 `reviewing`으로 전환된다.

| Job 상태 | 확인 사항 |
| --- | --- |
| `pending` | 다음 발행 시각과 publish attempt를 확인한다. |
| `publishing` | claim이 장시간 유지되는지 확인한다. 만료 claim은 publisher가 회수한다. |
| `queued` | SQS visible/in-flight 수와 전용 Worker desired/running count를 확인한다. |
| `processing` | Worker의 같은 `job_id`, `session_id` 로그와 OpenAI/handoff 분류를 확인한다. |
| `succeeded` | session이 `reviewing`이고 flow/file 전체가 저장됐는지 확인한다. |
| `failed` | `error_code`와 session의 `analysis_error_code`가 일치하는지 확인한다. |

App Server log group은 `/ecs/pilo-dev/app-server`, 전용 Worker log group은
`/ecs/pilo-dev/pr-review-ai-worker`다. App Server에서는
`PR Review analysis published`, `publish retry scheduled`, `publish retries exhausted`,
`Recovered stale PR Review analysis`와 24시간 상태 집계 로그를 확인한다. Worker에서는
`pr_review_analysis_started`와 `pr_review_analysis_finished`를 확인한다.

### Worker 관측 이벤트

| 이벤트 | 주요 필드 | 의미 |
| --- | --- | --- |
| `pr_review_analysis_stage` | `job_id`, `review_session_id`, `stage`, `outcome`, `elapsed_ms` | `input_handoff`, `provider`, `result_handoff`, `failure_handoff` 단계의 시작·완료·실패 |
| `pr_review_analysis_provider_started` | `model`, `file_count`, `patch_chars`, `relation_count`, `flow_count` | OpenAI에 전달한 분석 규모. 원문은 기록하지 않는다. |
| `pr_review_analysis_provider_succeeded` | `request_id`, `elapsed_ms`, `output_chars` | OpenAI 응답과 schema 검증이 완료됨 |
| `pr_review_analysis_provider_failed` | `category`, `error_type`, `status_code`, `request_id`, `elapsed_ms` | OpenAI 호출 자체의 retryable 또는 terminal 실패 |
| `pr_review_analysis_provider_output_invalid` | `error_type`, `request_id`, `elapsed_ms` | OpenAI 호출은 성공했지만 응답 schema 검증에 실패함 |

`pr_review_analysis_provider_failed`의 `error_type`은 예를 들어 `APITimeoutError`,
`APIConnectionError`, `RateLimitError`, `InternalServerError`처럼 원인 분류에 필요한 class 이름만
기록한다. provider 예외 메시지, 응답 body, prompt, patch, 생성 결과와 stack trace는 기록하지
않는다. `request_id`는 OpenAI 지원 또는 provider 로그와 대조할 때만 사용한다.

분석 지연은 다음 순서로 확인한다.

1. DB에서 `job_id`, `session_id`, Job 상태와 마지막 갱신 시각을 찾는다.
2. 같은 ID의 마지막 `pr_review_analysis_stage`를 찾는다.
3. `input_handoff` 실패면 App Server 또는 GitHub 입력 조회를 확인한다.
4. `provider` 실패면 `pr_review_analysis_provider_failed`의 `error_type`, `status_code`,
   `request_id`, `elapsed_ms`를 확인한다.
5. provider가 성공하고 `result_handoff`가 실패했다면 App Server 결과 저장과 DB 상태를
   확인한다.

## DB 확인

운영 확인은 read-only 조회만 사용한다. 상태를 맞추기 위해 DB row를 직접 수정하거나 failed
row를 pending으로 되돌리지 않는다.

```sql
SELECT
  s.id AS session_id,
  s.status AS session_status,
  s.head_sha,
  s.analysis_error_code,
  s.created_at AS session_created_at,
  s.updated_at AS session_updated_at,
  j.id AS job_id,
  j.status AS job_status,
  j.publish_attempt_count,
  j.error_code,
  j.published_at,
  j.updated_at AS job_updated_at
FROM pr_review_sessions AS s
JOIN pr_review_analysis_jobs AS j
  ON j.review_session_id = s.id
WHERE s.id = :session_id;
```

최근 24시간 상태 분포는 다음과 같이 확인한다.

```sql
SELECT status, COUNT(*)::integer AS count
FROM pr_review_analysis_jobs
WHERE created_at >= now() - INTERVAL '24 hours'
GROUP BY status
ORDER BY status;
```

## SQS 및 DLQ 확인

dev queue 이름은 `pilo-dev-pr-review-analysis`, DLQ는
`pilo-dev-pr-review-analysis-dlq`다. 두 queue의 visible/in-flight 메시지 수와 oldest message
age를 먼저 확인한다. 원본 queue의 `maxReceiveCount`는 3이고 visibility timeout은 900초다.

CloudWatch에서는 원본 queue backlog와 oldest message age, DLQ backlog, PR Review Worker
running task count alarm을 함께 확인한다. retryable infrastructure failure는 세 번째 receive에서
`ANALYSIS_PROVIDER_FAILED` internal failure handoff를 시도한다. handoff가 성공하면 Job/session을
terminal 처리한 뒤 source message를 삭제하고, handoff가 실패해 삭제하지 못한 message만 재시도 후
DLQ에 보존한다.

DLQ 메시지는 patch나 token을 출력하지 않고 `jobId`, `reviewSessionId`, `schemaVersion`만
확인한다. 메시지를 수동으로 원본 queue에 재전송하지 않는다. application terminalization과
DLQ redrive가 어긋나면 먼저 session/job 상태와 원인을 확인하고, 사용자 retry API로 새
session/job을 만든다.

## Terminal failure 재처리

1. session과 job이 모두 terminal인지 확인한다.
2. `ANALYSIS_ENQUEUE_FAILED`, `ANALYSIS_PROVIDER_FAILED`, `ANALYSIS_INPUT_INVALID`,
   `PR_HEAD_CHANGED` 중 안전한 error code를 확인한다.
3. 현재 GitHub PR head와 원본 session의 `head_sha` 차이를 확인한다.
4. 사용자가 실패 화면에서 재시도를 실행하거나 아래 공개 API를 호출한다.
5. 응답으로 받은 새 `session_id`와 새 Job을 추적한다.
6. 원본 failed session/job은 감사와 원인 분석을 위해 그대로 보존한다.

```http
POST /api/v1/workspaces/{workspaceId}/github/review-sessions/{failedSessionId}/retry
```

재시도는 failed session에만 허용되며 `201 Created`로 새 `analyzing` session을 반환한다.
이미 같은 사용자·PR의 analyzing session이 있으면 중복 Job 대신 기존 활성 session을
반환한다. failed가 아닌 session은 `409 Conflict`, 존재하지 않으면 `404 Not Found`다.

## Dev E2E 기록

### 2026-07-14 대형 PR 분석 관측 공백 발견

| 항목 | 결과 |
| --- | --- |
| PR | `#903`, 15 files, `+807/-44` |
| Session | `26396b3c-fd12-4c8c-9d25-e862cd6d0b50` |
| Job | `4939fdc1-5467-4b88-87c4-ca54a5f6ab93` |
| DB 상태 | session `analyzing`, job `processing` |
| 첫 재수신 | 최초 처리 시작 900초 뒤 Job `updated_at` 갱신 |
| 비교 결과 | 3 files PR은 21~32초에 완료됐고, 다른 15 files PR `#884`는 961초 뒤 완료 |
| 확인 한계 | 기존 Worker가 timeout, connection, rate limit, provider 5xx를 모두 `infrastructure_failure`로 축약해 최초 원인 확정 불가 |

이 사례를 계기로 위 provider·stage 관측 이벤트를 추가했다. 재현 후 오류 타입과 provider
소요 시간을 확인하기 전에는 timeout 또는 payload 규모를 확정 원인으로 기록하지 않는다.

### 2026-07-12 정상 분석

| 항목 | 결과 |
| --- | --- |
| PR | `#753`, 7 files, `+621/-30` |
| Session | `ace1db20-1abe-45db-815e-44cdedfc1ba9` |
| Job | `a2a45f61-f8b8-49a0-9553-d05c6b39da01` |
| 발행 | 약 0.07초, publish attempt 1회 |
| DB 분석 완료 | 37.68초 |
| Review room 표시 | 약 44.65초 |
| 최종 상태 | session `reviewing`, job `succeeded`, 7 files, error 없음 |
| 최근 24시간 Job | `succeeded 3`, `failed 3` |
| 점검 시 활성 Job | `pending/publishing/queued/processing` 모두 0 |

이 기록은 정상 경로 smoke 결과다. 중복 전달, 서비스 재시작, stale head, retry exhaustion과
DLQ 검증 결과는 해당 시나리오를 실행한 뒤 별도로 추가한다.

### 2026-07-12 App Server·Worker 재시작 중 Job 보존

| 항목 | 결과 |
| --- | --- |
| PR | `#753`, 7 files, `+621/-30` |
| Session | `3b459e38-39d3-441b-95ee-64a81130133f` |
| Job | `09264f6b-7641-4c77-887f-9d5805637a10` |
| Worker 중지 상태 | ECS desired/running `0/0`, session `analyzing`, job `queued` |
| 큐 보존 | 원본 queue visible `1`, in-flight `0`, publish attempt 1회 |
| App Server 교체 | task definition `pilo-dev-app-server:13`, 16:24~16:25 KST 배포 완료 |
| Worker 복구 | task definition `pilo-dev-pr-review-ai-worker:1`, desired/running `1/1` |
| 처리 로그 | 같은 job/session ID로 Worker started/finished, OpenAI HTTP 200 |
| 최종 상태 | session `reviewing`, job `succeeded`, 7 files, error 없음 |
| 총 경과 | 210.67초, Worker 중지 및 두 ECS service 안정화 시간 포함 |
| 종료 시 큐 | 원본 queue와 DLQ visible/in-flight/delayed 모두 0 |

이 시나리오는 App Server와 PR Review 전용 Worker task가 모두 교체되는 동안 SQS의 queued
Job이 유실되지 않고 새 Worker가 이어서 처리함을 확인한다. 다른 AI Worker와 SQS payload는
변경하지 않았다.

의도적인 DLQ 메시지 생성은 수행하지 않았다. 이를 위해서는 정상 Worker의 handoff 또는
provider 설정을 고의로 실패시켜야 하며 dev PR Review 분석을 일정 시간 실패시킨다. 대신
receive count 3회 소진과 terminal failure handoff는 AI Worker 자동 테스트로 검증하고, 실제
queue와 DLQ가 정상 시나리오 전후 모두 비어 있는지 확인했다.
