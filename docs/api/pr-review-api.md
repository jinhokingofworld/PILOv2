# PR Review API

## 범위

PR Review API는 다음 기능을 담당한다.

- Review session 생성, 조회, 상태 수정, 삭제
- AI가 생성한 PR 목적, 변경 요약, 주의점, flow, file review order와 검증된 semantic relation 저장과 조회
- Review file metadata와 파일별 review decision
- PR 리뷰 화면용 canvas view model
- Side-by-side diff view model
- GitHub Review 제출과 제출 이력

GitHub 원본 동기화, GitHub PR 원본 조회, 자유형 캔버스 저장, GitHub inline
comment, PR merge/close, ProjectV2 write는 이 문서의 범위가 아니다.

## GitHub Integration과의 경계

| 필요 기능 | 담당 API |
| --- | --- |
| Open PR 목록 | GitHub Integration |
| PR 상세 | GitHub Integration |
| PR 변경 파일과 patch | GitHub Integration |
| PR conflict 상태 | GitHub Integration |
| PR conflict resolution apply commit | PR Review + GitHub Integration 내부 dependency |
| 사용자 GitHub OAuth 연결 상태 | GitHub Integration |
| Review session, flow, file decision, submission | PR Review |

## 데이터 규칙

- Review session은 PR 리뷰 화면에 머무는 동안 사용하는 MVP 임시 작업 데이터다.
- 사용자가 PR 리뷰 화면을 나가면 review session 삭제 API를 호출한다.
- 세션 삭제 시 flow, file, semantic relation, file decision, submission history는 FK cascade로 함께 삭제된다.
- `review_submissions`는 화면 안에서 제출 결과와 실패 원인을 확인하기 위한 세션 내부 이력이다.
- `review_files`는 file metadata와 review state를 저장한다.
- Diff 응답은 GitHub Integration을 통해 PR 변경 파일과 patch 정보를 조회해 만든다.
- PR 리뷰 canvas는 `review_flows`, `review_files`, `review_flow_files`, `review_flow_relations`에서 생성하는 view model이다. 자유형 `canvas` 테이블에 저장하지 않는다.
- `review_flow_files`는 같은 review session에 속한 `review_flows`와 `review_files`만 연결한다.
- `review_flow_relations`는 같은 review session과 Flow에 속한 두 `review_flow_files` membership만 연결한다.
- GitHub Review 제출은 GitHub Integration에서 연결한 현재 사용자의 GitHub App user OAuth token으로 수행하며 review body만 제출한다.
- 현재 GitHub PR head SHA가 session의 `headSha`와 다르면 제출을 막는다.
- Conflict resolution apply는 현재 사용자의 GitHub App user OAuth token으로 PR head branch에
  하나 이상의 content conflict 파일을 해결한 단일 merge commit을 만든다.
- PILO가 만든 conflict resolution apply commit에 한해서 review session의 `headSha`와
  `conflictStatus`를 새 PR head 기준으로 갱신할 수 있다.
- Conflict resolution apply는 file review decision, review submission history, PR merge 상태를
  변경하지 않는다.

## 상태값

| Field | Values |
| --- | --- |
| `prReviewSession.status` | `analyzing`, `reviewing`, `ready_to_submit`, `submitted`, `failed`, `archived` |
| `reviewFile.currentStatus` | `not_reviewed`, `approved`, `discussion_needed`, `unknown` |
| `reviewFile.riskLevel` | `high`, `medium`, `low`, `unknown` |
| `reviewFile.roleType` | `entry`, `core_logic`, `api_contract`, `ui_state`, `verification`, `support`, `unknown` |
| `reviewFlowRelation.relationType` | `depends_on`, `tests`, `uses_api`, `passes_data_to`, `supports` |
| `reviewFlowRelation.source` | `rule`, `ai`, `hybrid` |
| `fileReviewDecision.status` | `approved`, `discussion_needed`, `unknown` |
| `reviewSubmission.submitType` | `COMMENT`, `APPROVE`, `REQUEST_CHANGES` |
| `reviewSubmission.githubSubmitStatus` | `not_submitted`, `submitting`, `submitted`, `failed` |
| `conflictStatus` | `checking`, `clean`, `conflicted`, `unknown` |
| `conflictFile.type` | `content`, `modify_delete`, `rename_modify`, `add_add`, `unsupported` |
| `conflictFile.resolutionStatus` | `unresolved`, `suggested`, `applied` |
| `conflictSuggestion.status` | `suggested`, `invalid` |
| `diff.mode` | `side_by_side`, `binary`, `large` |

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `POST` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-sessions` | Review session 생성 |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/retry` | Post-MVP 실패한 비동기 분석을 새 session으로 재시도 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 상세 조회 |
| `PATCH` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 상태 수정 |
| `DELETE` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 삭제 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/summary` | PR 요약 패널 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/result` | 전체 리뷰 결과 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/canvas` | 리뷰 canvas view model 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflicts` | Post-MVP read-only conflict 분석 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflict-apply` | Post-MVP 다중 conflict 해결안을 하나의 merge commit으로 적용 |
| `POST` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-suggestion` | Post-MVP AI conflict 해결 초안 생성 |
| `POST` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-apply` | 단일 conflict 해결안 적용 호환 endpoint |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/flows` | Flow 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-flows/{flowId}/files` | Flow에 속한 file 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}` | Review file 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/diff` | File diff view model 조회 |
| `PATCH` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/review` | 파일별 review decision 저장 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/decisions` | 파일별 decision history 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` | GitHub Review 제출 |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/merge` | Post-MVP GitHub PR merge 실행 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` | 제출 이력 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-submissions/{submissionId}` | 제출 상세 조회 |

## Review Session 생성

```json
{}
```

성공 응답은 `201 Created`다. 분석 자체는 비동기로 진행하므로 응답은 분석 결과가 없는
최소 session을 즉시 반환한다.

```json
{
  "id": "review_session_uuid",
  "pullRequestId": "pull_request_uuid",
  "headSha": "abc123",
  "status": "analyzing",
  "prPurpose": null,
  "changeSummary": [],
  "recommendedReviewOrder": null,
  "cautionPoints": [],
  "reviewedCount": 0,
  "totalFileCount": 0,
  "conflictStatus": "clean",
  "analysisError": null,
  "createdByUserId": "user_uuid"
}
```

서버 규칙:

- 생성 시 GitHub Integration API로 PR 상세와 conflict 상태를 조회한다. 변경 파일과
  patch 조회, OpenAI 분석은 HTTP 요청 경로에서 수행하지 않는다.
- 생성 시점의 `headSha`를 저장한다.
- session row와 `pr_review_analysis_jobs` row는 하나의 DB transaction으로 저장한다.
  `pr_review_analysis_jobs`는 job 자체와 durable outbox 발행 상태를 함께 보관하므로 별도
  outbox table을 만들지 않는다.
- transaction이 끝난 뒤 outbox publisher가 전용 SQS에 job을 발행한다. 발행 실패는 HTTP
  응답을 실패로 바꾸지 않으며, session은 `analyzing`으로 남아 발행 재시도 또는 terminal
  failure를 기다린다.
- 같은 사용자와 PR 조합에 이미 `analyzing` session이 있으면 새 job을 만들지 않는다.
  기존 session을 `200 OK`로 반환한다. `reviewing`, `failed` 등 terminal session은 이 규칙의
  대상이 아니므로 새 session 생성이 가능하다.
- `OPENAI_API_KEY` 누락, provider 오류, output 검증 오류를 deterministic fallback으로
  숨기지 않는다. 정해진 재시도 횟수가 소진되면 session을 `failed`로 전환한다.
- Diff 생성에 필요한 patch는 Worker가 인증된 내부 handoff로 App Server에서 받아오며 SQS
  payload, API 응답, 로그에 넣지 않는다.

### 분석 상태와 조회 규칙

`GET /workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`는 모든 session
상태에서 `200 OK`로 아래 필드를 포함한다. Frontend는 `analyzing` 상태에서 이 endpoint를
2초 간격으로 polling한다. 5분이 지나도 `analyzing`이면 실패로 바꾸지 않고 분석 지연 안내를
표시한 채 polling을 유지하며, `reviewing` 또는 `failed`가 되면 polling을 중지한다.
realtime은 후속 범위다.

```json
{
  "status": "failed",
  "analysisError": {
    "code": "PR_HEAD_CHANGED",
    "message": "PR의 최신 커밋이 분석 시작 시점과 달라 새 분석이 필요합니다."
  }
}
```

`analysisError`는 `analyzing`, `reviewing`, `ready_to_submit`, `submitted`, `archived` 상태에서
`null`이다. `failed`일 때에만 아래의 안전한 reason code와 사용자 노출 메시지를 반환한다.
provider 원문, token, patch, 내부 오류 상세는 반환하지 않는다.

| Code | 의미 | 사용자 다음 행동 |
| --- | --- | --- |
| `ANALYSIS_ENQUEUE_FAILED` | outbox의 SQS 발행 재시도가 소진됨 | 재시도 |
| `ANALYSIS_PROVIDER_FAILED` | OpenAI timeout, rate limit, provider 5xx 재시도가 소진됨 | 재시도 |
| `ANALYSIS_INPUT_INVALID` | 분석 입력 또는 structured output이 계약을 만족하지 않음 | 재시도 |
| `PR_HEAD_CHANGED` | Job/session head SHA와 현재 GitHub PR head SHA가 다름 | 재시도하여 새 session 생성 |

App Server는 60초 간격으로 stale 분석을 확인한다. `processing` 상태가 20분 동안
갱신되지 않거나 `queued` 상태가 60분 동안 Worker에 인수되지 않으면 Job과 session을
`failed(ANALYSIS_PROVIDER_FAILED)`로 함께 종료한다. 이후 도착한 같은 Job의 결과는
terminal 상태를 유지하고 저장하지 않는다.

분석 결과가 필요한 `summary`, `result`, `canvas`, `flows` endpoint는 session이 `analyzing`이면
`409 REVIEW_ANALYSIS_NOT_READY`를 반환하고, `failed`이면 `409 REVIEW_ANALYSIS_FAILED`를
반환한다. 빈 graph 또는 fallback 결과를 성공 응답으로 반환하지 않는다.

### 분석 재시도

```http
POST /api/v1/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/retry
```

재시도는 `failed` session에서만 허용한다. 기존 session의 head SHA나 분석 결과를 바꾸지
않고, 현재 PR 상태를 기준으로 새 `analyzing` session과 새 job/outbox intent를 생성해
`201 Created`로 반환한다. `failed`가 아닌 상태에는 `409 REVIEW_ANALYSIS_RETRY_NOT_ALLOWED`를
반환한다.

### Worker job 및 internal handoff 계약

PR Review analysis job은 전용 SQS와 DLQ를 사용한다. 기존 Meeting/Agent AI queue와 Worker
service는 공유하지 않으며, 동일한 AI Worker 이미지를 실행하는 PR Review 전용 ECS service가
이 queue만 polling한다.

SQS message는 아래 식별자만 포함한다. patch, GitHub token, 사용자 OAuth token, provider
response는 포함하지 않는다.

```json
{
  "jobType": "pr_review_analysis_requested",
  "schemaVersion": "pr-review-analysis:v1",
  "jobId": "pr_review_analysis_job_uuid",
  "reviewSessionId": "review_session_uuid",
  "workspaceId": "workspace_uuid",
  "headSha": "abc123"
}
```

AI Worker는 DB에 PR Review 결과를 직접 쓰지 않는다. 전용 worker token으로 보호된 App Server
internal handoff를 사용한다.

세 internal endpoint는 `X-Pr-Review-Analysis-Worker-Token` header가
`PR_REVIEW_ANALYSIS_WORKER_TOKEN`과 일치할 때만 호출할 수 있다. 누락되었거나 일치하지 않는
token은 `401`로 거부한다. 이 token은 사용자 API, SQS message, 로그에 노출하지 않는다.

| Method | Internal endpoint | 책임 |
| --- | --- | --- |
| `GET` | `/api/v1/internal/pr-review/analysis-jobs/{jobId}/input` | session/job 상태와 head SHA를 검증하고 PR detail·변경 파일·patch를 Worker에 전달 |
| `POST` | `/api/v1/internal/pr-review/analysis-jobs/{jobId}/result` | 결과를 검증하고 현재 GitHub head SHA를 다시 확인한 뒤 session, flow, file 관계를 원자 저장 |
| `POST` | `/api/v1/internal/pr-review/analysis-jobs/{jobId}/failure` | 안전한 failure code를 저장하고 terminal session 처리 |

`GET /api/v1/internal/pr-review/analysis-jobs/{jobId}/input` 성공 응답은 아래처럼
공통 response envelope 안에 Worker 분석 입력을 담는다. Worker는 response의 `jobId`,
`reviewSessionId`, `workspaceId`, `headSha`가 SQS payload와 모두 일치할 때만 분석한다.
App Server는 유효한 입력 요청을 받을 때 Job을 `processing`으로 전환하며, 같은 Job의
재전달은 처리 시작 시각을 갱신한다.

```json
{
  "success": true,
  "data": {
    "jobId": "pr_review_analysis_job_uuid",
    "reviewSessionId": "review_session_uuid",
    "workspaceId": "workspace_uuid",
    "headSha": "abc123",
    "pullRequest": {
      "prNumber": 24,
      "title": "Async PR analysis",
      "body": "...",
      "state": "open",
      "draft": false,
      "mergeable": true,
      "authorLogin": "octocat",
      "headBranch": "feature/async",
      "baseBranch": "dev",
      "baseSha": "base_sha",
      "changedFilesCount": 2,
      "additions": 20,
      "deletions": 4,
      "commitsCount": 2
    },
    "files": [
      {
        "filePath": "apps/app-server/src/pr-review.ts",
        "previousFilePath": null,
        "fileName": "pr-review.ts",
        "fileStatus": "modified",
        "additions": 12,
        "deletions": 3,
        "isBinary": false,
        "isLargeDiff": false,
        "patch": "..."
      }
    ]
  }
}
```

`POST /api/v1/internal/pr-review/analysis-jobs/{jobId}/result`는 Worker가 검증한 분석
결과를 아래 형식으로 전달한다. path의 `jobId`와 body의 네 식별자(`jobId`,
`reviewSessionId`, `workspaceId`, `headSha`)는 모두 Job row와 일치해야 한다.

```json
{
  "jobId": "pr_review_analysis_job_uuid",
  "reviewSessionId": "review_session_uuid",
  "workspaceId": "workspace_uuid",
  "headSha": "abc123",
  "analysis": {
    "prPurpose": "string",
    "changeSummary": ["string"],
    "recommendedReviewOrder": "string",
    "cautionPoints": ["string"],
    "flowTitle": "string",
    "flowDescription": "string",
    "files": [
      {
        "filePath": "string",
        "fileRole": "string",
        "riskLevel": "high | medium | low | unknown",
        "changeReason": "string",
        "changeSummary": "string",
        "reviewPoints": ["string"]
      }
    ]
  }
}
```

App Server는 현재 GitHub head SHA, Job head SHA, session head SHA를 다시 비교한다.
셋 중 하나라도 다르면 flow/file을 만들지 않고 Job과 session을
`failed(PR_HEAD_CHANGED)`로 끝낸다. 일치하면 summary, flow, file, flow-file 관계와
Job terminal 상태를 하나의 transaction으로 저장하고, 마지막에만 session을
`reviewing`으로 전환한다. 같은 Job의 재전달은 이미 저장된 terminal 결과를 반환하며
새 row를 만들지 않는다.

`POST /api/v1/internal/pr-review/analysis-jobs/{jobId}/failure`는 raw provider 오류를
보내지 않고 아래의 안전한 code만 전달한다. App Server는 code별 사용자 메시지를
session에 저장하고, Job에는 운영 추적용 terminal 상태만 남긴다.

```json
{
  "jobId": "pr_review_analysis_job_uuid",
  "reviewSessionId": "review_session_uuid",
  "workspaceId": "workspace_uuid",
  "headSha": "abc123",
  "code": "ANALYSIS_PROVIDER_FAILED"
}
```

두 POST endpoint의 성공 응답은 다음과 같다. `persisted: false`는 중복 전달로 이미
같은 terminal 결과가 존재한다는 뜻이다.

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "status": "reviewing | failed",
    "persisted": true
  }
}
```

App Server는 job/session이 여전히 `analyzing`이고 job 상태가 `publishing`, `queued`,
`processing` 중 하나이며 job·session·현재 GitHub head SHA가 모두 같을 때만 이 입력을
반환한다. `publishing` 허용은 SQS send 성공과 publisher의 `queued` 갱신 사이에 Worker가
먼저 message를 받는 at-least-once race를 처리하기 위한 것이다. 응답에는 GitHub OAuth token,
GitHub URL, provider raw error를 포함하지 않는다.

Worker는 `pr_review_analysis_requested`와 `pr-review-analysis:v1`만 수용한다. malformed
payload, input 불일치, strict output의 빈 핵심 필드·누락/중복 file path·잘못된 risk level은
terminal 처리한다. timeout, rate limit, provider 5xx, internal handoff network/5xx 오류는
SQS 재수신 대상으로 남긴다. Worker는 DB에 직접 결과를 쓰지 않고, 검증한 분석 결과만
`result` internal endpoint로 전달한다.

결과 저장은 session이 여전히 `analyzing`이고 job/session/current GitHub head SHA가 모두 같은
경우에만 수행한다. 저장 transaction의 마지막 단계에서 session을 `reviewing`으로 전환한다.
동일 job의 SQS 재전달 또는 result 재전송은 이미 성공한 결과를 그대로 인정하며 새 flow/file을
만들지 않는다.

outbox 발행은 1, 2, 4, 8, 16분 간격으로 최대 5회 재시도한다. Worker의 timeout, rate limit,
provider 5xx와 handoff 일시 오류는 SQS receive count 3회까지 재시도한다. 각 재시도 소진 시
App Server가 session을 해당 안전한 `failed` reason code로 전환한 뒤 메시지를 terminal 처리한다.

### OpenAI 분석 계약

PR Review 전용 Worker는 Responses API의 strict JSON schema `pr_review_analysis`를 사용한다.
모델은 `OPENAI_PR_REVIEW_MODEL`을 사용하고, 값이 없으면 `gpt-5.1-mini`를 사용한다. Worker의
provider timeout은 `OPENAI_PR_REVIEW_TIMEOUT_MS`로 설정하며 기본값은 60초다. PR Review 전용
worker runtime은 `SQS_PR_REVIEW_ANALYSIS_QUEUE_URL`, `PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL`,
`PR_REVIEW_ANALYSIS_WORKER_TOKEN`을 별도로 사용한다. 이 분석 계약은
기존 동기 PR 분석의 모델·prompt 목적·출력 구조를 유지한 것이며, conflict suggestion의 모델,
prompt, 동기 호출 방식은 변경하지 않는다.

입력은 PR body 최대 4,000자, 각 file patch 최대 4,000자, 전체 patch 최대 32,000자로 제한한다.
출력에는 아래 필드가 모두 있어야 하며, 각 input file path는 정확히 한 번씩 대응해야 한다.

```json
{
  "prPurpose": "string",
  "changeSummary": ["string"],
  "recommendedReviewOrder": "string",
  "cautionPoints": ["string"],
  "flowTitle": "string",
  "flowDescription": "string",
  "files": [
    {
      "filePath": "string",
      "fileRole": "string",
      "riskLevel": "high | medium | low | unknown",
      "changeReason": "string",
      "changeSummary": "string",
      "reviewPoints": ["string"]
    }
  ]
}
```

빈 핵심 필드, input에 없는 file path, 중복 file path, 허용되지 않은 risk level은
`ANALYSIS_INPUT_INVALID`로 terminal 처리한다. 비동기 PR 분석에는 deterministic fallback을
사용하지 않는다.

## Review Session 삭제

사용자가 PR 리뷰 화면을 나갈 때 호출한다.

```http
DELETE /api/v1/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}
```

응답:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

삭제 규칙:

- `review_flows`, `review_files`, `review_flow_files`, `review_flow_relations`는 session 삭제와 함께 삭제된다.
- `file_review_decisions`는 `review_files` 삭제에 의해 함께 삭제된다.
- `review_submissions`는 session 삭제와 함께 삭제된다.
- PR Review canvas는 자유형 `canvas` 테이블에 저장하지 않으므로 별도 canvas 삭제 작업은 없다.

## PR 요약 패널 조회

`summary` endpoint는 PR 리뷰 화면의 상단 헤더와 우측 요약 패널에 필요한 정보를
반환한다. 상대 시간 문구는 서버가 만들지 않고 `githubCreatedAt`,
`githubUpdatedAt`을 내려주며 프론트에서 표시한다.

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "pullRequestId": "pull_request_uuid",
    "githubNumber": 24,
    "title": "음성회의 및 리포트 페이지 목업 구현",
    "authorName": "jinhokingofworld",
    "authorAvatarUrl": "https://github.com/avatar.png",
    "githubCreatedAt": "2026-07-04T12:00:00.000Z",
    "githubUpdatedAt": "2026-07-05T00:00:00.000Z",
    "headBranch": "feature/voice-report",
    "baseBranch": "main",
    "changedFilesCount": 5,
    "additions": 128,
    "deletions": 32,
    "commitsCount": 3,
    "githubUrl": "https://github.com/my-team/pilo/pull/24",
    "headSha": "abc123",
    "pullRequestState": "open",
    "pullRequestMergeable": true,
    "pullRequestMergedAt": null,
    "status": "reviewing",
    "prPurpose": "음성 회의 페이지와 회의 종료 후 리포트 UI 흐름 추가",
    "changeSummary": ["음성 회의 페이지 추가", "리포트 게시판 화면 추가"],
    "recommendedReviewOrder": "공통 진입 구조를 먼저 확인한 뒤 각 페이지 UI를 확인",
    "cautionPoints": ["사이드바 탭과 라우팅 경로 일치 여부 확인"],
    "reviewedCount": 2,
    "totalFileCount": 5,
    "conflictStatus": "clean",
    "conflictCheckedAt": "2026-07-05T00:00:00.000Z",
    "readyToSubmit": false
  }
}
```

`summary` 조회 시 저장된 `conflictStatus`가 `checking` 또는 `unknown`이면 GitHub의
최신 conflict 상태를 다시 확인한다. `checking`은 짧은 간격으로 제한된 횟수만
재확인하며, 같은 session `headSha`가 유지되는 경우에만 최신 상태와 확인 시각을
`pr_review_sessions`에 저장한다. 재확인에 실패하면 기존 상태를 유지해 요약 조회 자체는
실패시키지 않는다.

## 전체 리뷰 결과 조회

`result` endpoint는 GitHub Review 제출 모달에서 파일별 판단 결과를 요약할 수 있는
형태로 반환한다.
`readyToSubmit`은 모든 파일에 판단이 들어갔는지 보여주는 진행률 신호이며,
GitHub Review 제출 가능 여부를 막는 hard guard가 아니다. `not_reviewed` 파일이
남아 있어도 Review 제출은 가능하고, 해당 개수는 summary와 counts에 그대로 포함된다.

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "status": "reviewing",
    "reviewResultSummary": "문제 없음 3개 / 논의·수정 필요 1개 / 판단 불가 1개 / 미리뷰 0개",
    "counts": {
      "approved": 3,
      "discussionNeeded": 1,
      "unknown": 1,
      "notReviewed": 0,
      "total": 5
    },
    "fileReviewResults": [
      {
        "reviewFileId": "review_file_uuid",
        "fileName": "VoiceMeetingPage.tsx",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "status": "approved",
        "comment": "문제 없음",
        "reviewedByUserId": "user_uuid",
        "reviewedAt": "2026-07-05T00:00:00.000Z"
      }
    ],
    "readyToSubmit": true
  }
}
```

## Review Canvas View Model

리뷰 canvas endpoint는 PR 리뷰 화면용 graph를 반환한다. 자유형 Canvas API와
분리된 view model이다.

```json
{
  "reviewSessionId": "review_session_uuid",
  "headBranch": "feature/voice-report",
  "baseBranch": "main",
  "reviewedCount": 2,
  "totalFileCount": 5,
  "conflictStatus": "clean",
  "flows": [
    {
      "id": "flow_uuid",
      "reviewSessionId": "review_session_uuid",
      "title": "Entry flow",
      "description": "Review entry points first",
      "sortOrder": 1,
      "fileCount": 2,
      "files": [
        {
          "id": "review_flow_file_uuid",
          "reviewSessionId": "review_session_uuid",
          "flowId": "flow_uuid",
          "reviewFileId": "review_file_uuid",
          "filePath": "apps/frontend/page.tsx",
          "fileName": "page.tsx",
          "fileStatus": "modified",
          "fileRole": "프론트엔드",
          "roleType": "ui_state",
          "riskLevel": "medium",
          "workflowOrder": 1,
          "currentStatus": "not_reviewed",
          "fileNodeData": {
            "reviewFileId": "review_file_uuid",
            "reviewSessionId": "review_session_uuid",
            "reviewFlowFileId": "review_flow_file_uuid",
            "flowId": "flow_uuid",
            "workflowOrder": 1,
            "fileName": "page.tsx",
            "filePath": "apps/frontend/page.tsx",
            "roleSummary": "프론트엔드",
            "roleType": "ui_state",
            "riskLevel": "medium",
            "reviewStatus": "not_reviewed"
          }
        }
      ]
    }
  ],
  "edges": [
    {
      "id": "relation_uuid",
      "fromReviewFileId": "review_file_uuid_1",
      "toReviewFileId": "review_file_uuid_2",
      "fromReviewFlowFileId": "review_flow_file_uuid_1",
      "toReviewFlowFileId": "review_flow_file_uuid_2",
      "flowId": "flow_uuid",
      "relationType": "depends_on",
      "reason": "Controller가 Service의 변경된 기능을 호출합니다.",
      "source": "hybrid",
      "confidence": 88
    }
  ]
}
```

`roleType`은 graph layout과 검증에 사용하는 정규화된 역할이다. 허용값은
`entry`, `core_logic`, `api_contract`, `ui_state`, `verification`, `support`,
`unknown`이다. 기존 `fileRole`과 `roleSummary`는 사람이 읽는 설명으로 유지한다.

semantic edge의 `relationType`은 `depends_on`, `tests`, `uses_api`,
`passes_data_to`, `supports` 중 하나다. `source`는 `rule`, `ai`, `hybrid` 중 하나이며,
`confidence`는 `0`부터 `100`까지의 정수다. Canvas 응답에는 서버 검증을 통과하고
`confidence >= 60`인 관계만 포함한다. 관계는 같은 review session과 Flow에 속한 두
file membership만 연결하고 self edge와 같은 type의 중복 관계를 허용하지 않는다.

한 Flow에 semantic edge가 하나라도 있으면 해당 Flow에는 semantic edge만 반환한다.
semantic edge가 없는 기존 session 또는 Flow는 기존 `workflowOrder` 인접 파일을
`relationType: review_order`, `source: fallback`, `confidence: 100`으로 연결한다.
semantic relation은 새 분석 session부터 저장하며 기존 완료 session을 backfill하지 않는다.

PR Review schema에는 `canvas_id`, `canvas_shape_id`,
`canvas_freeform_shapes` 관계가 없다.

## Flow 목록 조회

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "flows": [
      {
        "id": "flow_uuid",
        "reviewSessionId": "review_session_uuid",
        "title": "공통 네비게이션",
        "description": "사이드바와 라우팅 흐름",
        "sortOrder": 1,
        "fileCount": 3
      }
    ]
  }
}
```

## Flow 파일 노드 목록 조회

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "flowId": "flow_uuid",
    "files": [
      {
        "id": "review_flow_file_uuid",
        "reviewSessionId": "review_session_uuid",
        "flowId": "flow_uuid",
        "reviewFileId": "review_file_uuid",
        "workflowOrder": 1,
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "fileName": "VoiceMeetingPage.tsx",
        "fileStatus": "modified",
        "fileRole": "프론트엔드",
        "roleType": "ui_state",
        "riskLevel": "medium",
        "currentStatus": "not_reviewed",
        "fileNodeData": {
          "reviewFileId": "review_file_uuid",
          "reviewSessionId": "review_session_uuid",
          "reviewFlowFileId": "review_flow_file_uuid",
          "flowId": "flow_uuid",
          "workflowOrder": 1,
          "fileName": "VoiceMeetingPage.tsx",
          "filePath": "apps/frontend/VoiceMeetingPage.tsx",
          "roleSummary": "프론트엔드",
          "roleType": "ui_state",
          "riskLevel": "medium",
          "reviewStatus": "not_reviewed"
        }
      }
    ]
  }
}
```

## Review File 상세 조회

```json
{
  "success": true,
  "data": {
    "id": "review_file_uuid",
    "sessionId": "review_session_uuid",
    "filePath": "apps/frontend/VoiceMeetingPage.tsx",
    "previousFilePath": null,
    "fileName": "VoiceMeetingPage.tsx",
    "fileStatus": "modified",
    "additions": 84,
    "deletions": 12,
    "isBinary": false,
    "isLargeDiff": false,
    "githubFileUrl": "https://github.com/my-team/pilo/pull/24/files#diff-abc",
    "fileRole": "프론트엔드",
    "roleType": "ui_state",
    "riskLevel": "medium",
    "changeReason": "수정된 파일이다.",
    "changeSummary": "84줄 추가, 12줄 삭제",
    "reviewPoints": ["Workflow order 1번으로 확인한다."],
    "currentStatus": "not_reviewed",
    "comment": null,
    "reviewedByUserId": null,
    "reviewedAt": null,
    "flowMemberships": [
      {
        "reviewFlowFileId": "review_flow_file_uuid",
        "flowId": "flow_uuid",
        "flowTitle": "공통 네비게이션",
        "workflowOrder": 1
      }
    ],
    "latestDecision": null
  }
}
```

## Diff View Model

기본 diff는 side-by-side로 반환한다. Binary 파일 또는 큰 diff는 본문 diff를 내려주지 않고
안내 메시지와 GitHub 파일 URL을 반환한다.

큰 diff 기준은 아래 중 하나다.

- `additions + deletions >= 1000`
- `patchSizeBytes >= 200KB`
- GitHub patch가 누락된 경우

Side-by-side 응답:

```json
{
  "success": true,
  "data": {
    "reviewFileId": "review_file_1",
    "filePath": "apps/frontend/VoiceMeetingPage.tsx",
    "mode": "side_by_side",
    "isBinary": false,
    "isLargeDiff": false,
    "githubFileUrl": "https://github.com/my-team/pilo/pull/24/files#diff-abc",
    "rows": [
      {
        "type": "unchanged",
        "oldLineNumber": 10,
        "newLineNumber": 10,
        "oldText": "const title = 'Meeting';",
        "newText": "const title = 'Meeting';"
      },
      {
        "type": "added",
        "oldLineNumber": null,
        "newLineNumber": 11,
        "oldText": null,
        "newText": "const status = 'recording';"
      }
    ]
  }
}
```

Binary 또는 large diff 응답:

```json
{
  "success": true,
  "data": {
    "reviewFileId": "review_file_2",
    "filePath": "assets/report-preview.png",
    "mode": "binary",
    "isBinary": true,
    "isLargeDiff": false,
    "githubFileUrl": "https://github.com/my-team/pilo/pull/24/files#diff-def",
    "message": "Binary 파일은 PILO diff에서 미리보기하지 않습니다. GitHub에서 확인해주세요.",
    "rows": []
  }
}
```

## Conflict Analysis 조회

Post-MVP Phase 1-B에서 구현할 read-only conflict 분석 계약이다.
초기 구현은 conflict 정보를 저장하지 않고 요청 시 계산하며, PR head branch를 수정하거나
GitHub merge API를 호출하지 않는다.

```http
GET /api/v1/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflicts
```

응답:

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "pullRequestId": "pull_request_uuid",
    "headSha": "abc123",
    "baseSha": "def456",
    "conflictStatus": "conflicted",
    "analysisMode": "sync",
    "stored": false,
    "supportedTypes": ["content"],
    "files": [
      {
        "reviewFileId": "review_file_1",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "previousFilePath": null,
        "type": "content",
        "isSupported": true,
        "resolutionStatus": "unresolved",
        "headBlobSha": "file_blob_sha",
        "headContent": "const title = 'Meeting room';",
        "hunks": [
          {
            "id": "hunk_1",
            "header": "@@ -10,5 +10,7 @@",
            "baseStartLine": 10,
            "baseLineCount": 5,
            "currentStartLine": 10,
            "currentLineCount": 6,
            "incomingStartLine": 10,
            "incomingLineCount": 7,
            "baseText": "const title = 'Meeting';",
            "currentText": "const title = 'Voice meeting';",
            "incomingText": "const title = 'Meeting room';"
          }
        ],
        "aiSummary": null,
        "aiSuggestion": null,
        "resolvedContent": null
      }
    ],
    "unsupportedFiles": [
      {
        "reviewFileId": "review_file_2",
        "filePath": "assets/report-preview.png",
        "type": "unsupported",
        "reason": "binary conflict is not supported in the initial read-only slice"
      }
    ]
  }
}
```

서버 규칙:

- 이 endpoint는 review session 기준으로 동작한다.
- 현재 사용자는 review session이 속한 Workspace에 접근할 수 있어야 한다.
- 현재 GitHub PR head SHA가 session의 `headSha`와 다르면 stale session으로 보고
  `409 Conflict`를 반환한다.
- `conflictStatus`가 `clean`, `checking`, `unknown`이면 `files`는 빈 배열로 반환한다.
- 초기 read-only slice는 `content` conflict만 `isSupported: true`로 반환한다.
- `content` conflict file은 PR head branch의 현재 file blob SHA를 `headBlobSha`로 포함한다.
  이 값은 후속 apply 요청의 변경 감지 guard로 사용한다.
- `headContent`는 PR head branch의 파일 전체 원문이다. 클라이언트는 이 원문에 hunk별
  선택 결과를 적용해 최종 `resolvedContent`를 조립한다.
- `baseText`는 merge base의 원본 구간이고, `currentText`는 base branch 쪽 변경,
  `incomingText`는 PR head branch 쪽 변경이다.
- `modify_delete`, `rename_modify`, `add_add`, `unsupported`는 후속 slice에서 처리하며,
  초기 구현에서는 `unsupportedFiles`에 안내용 metadata만 반환할 수 있다.
- conflict 분석 결과는 초기 read-only slice에서 DB에 저장하지 않는다.
- `review_files.current_status`, `file_review_decisions`, `review_submissions`를 변경하지 않는다.
- GitHub 원본 content 조회와 merge simulation은 PR Review 내부 dependency adapter를 통해
  수행하며, GitHub token은 응답과 로그에 노출하지 않는다.
- AI explanation, AI suggestion, Apply resolution, PR head branch commit, merge 실행은 이
  endpoint의 범위가 아니다.

## AI Conflict Suggestion Draft 생성

Post-MVP Phase 1-D에서 구현하는 사용자 요청 기반 AI suggestion 생성 계약이다.
이 endpoint는 conflict 파일 하나에 대해 transient hunk별 AI 해결안과 서버가 조립한 파일 전체
초안을 반환하며, DB에 저장하거나 PR head branch를 수정하지 않는다.

```http
POST /api/v1/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-suggestion
```

요청 body:

```json
{
  "currentDraft": {
    "resolvedContent": "const title = 'Voice meeting room';",
    "hunks": [
      {
        "hunkId": "hunk_1",
        "source": "manual",
        "resolvedText": "const title = 'Voice meeting room';"
      }
    ]
  }
}
```

`currentDraft`는 선택값이다. 생략하면 기존과 같이 원본 Conflict만 사용해 초안을
생성한다. 현재 해결 작업이 있으면 파일 전체 코드와 이미 선택하거나 직접 편집한 hunk를
함께 전달한다. `source`는 `ai`, `pr`, `target`, `both`, `manual` 중 하나다.

응답:

```json
{
  "success": true,
  "data": {
    "reviewFileId": "review_file_1",
    "filePath": "apps/frontend/VoiceMeetingPage.tsx",
    "previousFilePath": null,
    "type": "content",
    "status": "suggested",
    "headSha": "abc123",
    "headBlobSha": "file_blob_sha",
    "aiSummary": "같은 title 상수를 base branch와 head branch가 서로 다른 문구로 수정해 충돌했습니다.",
    "aiSuggestion": "두 문구의 의미를 합쳐 화면 맥락이 드러나는 이름으로 정리하는 초안입니다.",
    "resolvedHunks": [
      {
        "hunkId": "hunk_1",
        "resolvedText": "const title = 'Voice meeting room';"
      }
    ],
    "resolvedContent": "const title = 'Voice meeting room';",
    "validationMessages": [],
    "stored": false
  }
}
```

서버 규칙:

- 현재 사용자는 review file이 속한 Workspace에 접근할 수 있어야 한다.
- 현재 GitHub PR head SHA가 session의 `headSha`와 다르면 stale session으로 보고
  `409 Conflict`를 반환한다.
- `content` conflict file만 suggestion 생성 대상이다.
- `binary`, `large`, `modify_delete`, `rename_modify`, `add_add`, `unsupported` conflict는
  초기 AI suggestion slice에서 `400 Bad Request`로 막는다.
- `OPENAI_API_KEY`가 있으면 OpenAI Responses API structured output을 사용하고,
  key 누락/API 실패/응답 검증 실패 시 deterministic fallback 초안을 반환한다.
- AI output은 사용자가 확인하기 전까지 suggestion으로만 취급한다.
- `currentDraft`가 있으면 AI는 현재 선택과 수동 수정 내용을 사용자 의도로 취급하고 다른
  hunk와 함께 검토한다. suggestion 생성만으로 현재 draft나 선택을 변경하지 않는다.
- `currentDraft.hunks`는 현재 선택이 있는 hunk만 전달할 수 있다. `hunkId`는 요청 시점의
  Conflict hunk와 일치해야 하고 중복될 수 없다.
- `currentDraft.resolvedContent`와 각 `resolvedText`는 conflict marker를 포함할 수 없으며
  파일 적용 크기 제한을 넘을 수 없다. hunk 전체 삭제를 나타내는 빈 `resolvedText`는 허용한다.
- `resolvedHunks`는 요청 시점에 계산된 모든 conflict hunk를 `hunkId`로 식별하며, 각
  `resolvedText`는 해당 hunk만 대체할 코드다. 코드 전체를 Markdown fence로 감싸지 않는다.
- 서버는 PR head 파일 원문에 `resolvedHunks`를 뒤쪽 hunk부터 적용해 `resolvedContent`를
  조립한다. AI가 누락한 hunk는 deterministic fallback 결과로 보완한다.
- `resolvedContent`는 실제 Git merge 결과에서 선택한 conflict 파일을 대체할 전체 내용이어야 한다.
- 응답의 `headSha`와 `headBlobSha`는 suggestion 생성 시점의 PR head/file blob guard 값이다.
  사용자는 이 값을 그대로 apply 요청에 전달해야 한다.
- hunk의 `resolvedText` 또는 조립된 `resolvedContent`가 `<<<<<<<`, `=======`, `>>>>>>>`
  conflict marker를 포함하거나, `resolvedContent`가 비어 있으면 `status: "invalid"`와
  `validationMessages`를 반환한다. hunk 전체 삭제를 뜻하는 빈 `resolvedText`는 허용한다.
- PR head 파일 전체 content가 apply 크기 제한을 초과하면 suggestion/apply 대상에서 제외한다.
- suggestion 결과는 DB에 저장하지 않는다.
- `review_files.current_status`, `file_review_decisions`, `review_submissions`를 변경하지 않는다.
- GitHub branch commit, GitHub merge API 호출, Apply resolution은 이 endpoint의 범위가 아니다.

## Conflict Resolution Apply

사용자 확인 기반 conflict 해결 적용 계약이다. session 단위 endpoint는 모든 `content`
conflict 파일의 해결 코드를 한 요청으로 받아 PR head와 base를 parent로 갖는 merge commit
하나로 적용한다. 일부 파일만 commit하거나 PR merge/close를 수행하지 않는다.

```http
POST /api/v1/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflict-apply
```

요청 body:

```json
{
  "expectedHeadSha": "abc123",
  "files": [
    {
      "reviewFileId": "review_file_1",
      "resolvedContent": "const title = 'Voice meeting room';",
      "expectedHeadBlobSha": "file_blob_sha_1"
    },
    {
      "reviewFileId": "review_file_2",
      "resolvedContent": "export const timeout = 45;",
      "expectedHeadBlobSha": "file_blob_sha_2"
    }
  ]
}
```

응답:

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_1",
    "pullRequestId": "pull_request_1",
    "status": "applied",
    "appliedByGithubLogin": "octocat",
    "commitSha": "commit_sha",
    "commitUrl": "https://github.com/org/repo/commit/commit_sha",
    "headShaBefore": "abc123",
    "headShaAfter": "def456",
    "files": [
      {
        "reviewFileId": "review_file_1",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "headBlobShaBefore": "file_blob_sha_1",
        "headBlobShaAfter": "new_file_blob_sha_1"
      },
      {
        "reviewFileId": "review_file_2",
        "filePath": "apps/app-server/src/meeting.ts",
        "headBlobShaBefore": "file_blob_sha_2",
        "headBlobShaAfter": "new_file_blob_sha_2"
      }
    ],
    "conflictStatus": "clean",
    "conflictCheckedAt": "2026-07-10T00:00:00.000Z",
    "localStateStatus": "updated"
  }
}
```

단일 파일 호환 endpoint:

```http
POST /api/v1/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-apply
```

요청 body:

```json
{
  "resolvedContent": "const title = 'Voice meeting room';",
  "expectedHeadSha": "abc123",
  "expectedHeadBlobSha": "file_blob_sha"
}
```

응답:

```json
{
  "success": true,
  "data": {
    "reviewFileId": "review_file_1",
    "filePath": "apps/frontend/VoiceMeetingPage.tsx",
    "type": "content",
    "status": "applied",
    "appliedByGithubLogin": "octocat",
    "commitSha": "commit_sha",
    "commitUrl": "https://github.com/org/repo/commit/commit_sha",
    "headShaBefore": "abc123",
    "headShaAfter": "def456",
    "headBlobShaBefore": "file_blob_sha",
    "headBlobShaAfter": "new_file_blob_sha",
    "conflictStatus": "clean",
    "conflictCheckedAt": "2026-07-10T00:00:00.000Z",
    "localStateStatus": "updated"
  }
}
```

서버 규칙:

- 현재 사용자는 review session 또는 review file이 속한 Workspace에 접근할 수 있어야 한다.
- 현재 사용자의 GitHub App user OAuth 연결이 필요하다.
- GitHub App에는 `Contents: write` permission이 필요하다. 권한 부족으로 GitHub가
  `403`을 반환하면 provider raw error 대신 안전한 권한 오류를 반환한다.
- `content` conflict file만 apply 대상이다. `binary`, `large`, `modify_delete`,
  `rename_modify`, `add_add`, `unsupported` conflict는 `400 Bad Request`로 막는다.
- session 단위 요청의 `files`는 비어 있을 수 없고 `reviewFileId`가 중복될 수 없다.
- PR에 unsupported conflict 후보가 하나라도 있으면 전체 적용을 막는다.
- 요청 파일 집합은 분석된 모든 supported conflict 파일 집합 및 실제 Git merge의 미해결
  경로 집합과 정확히 일치해야 한다. 파일이 누락·추가되거나 분석 후 conflict 상태가
  바뀌었으면 push 없이 `409 Conflict`를 반환한다.
- 단일 파일 호환 endpoint는 PR 전체의 supported conflict 파일이 정확히 1개일 때만 허용한다.
- 한 파일 안의 conflict hunk 개수에는 제한을 두지 않는다. 모든 hunk가 반영된 파일 전체
  `resolvedContent`를 하나의 resolved blob으로 사용한다.
- 현재 GitHub PR head SHA가 session의 `headSha` 또는 요청의 `expectedHeadSha`와 다르면
  stale session으로 보고 `409 Conflict`를 반환한다.
- PR head branch의 현재 file blob SHA가 각 파일의 `expectedHeadBlobSha`와 다르면
  stale file로 보고 `409 Conflict`를 반환한다.
- 각 `resolvedContent`가 비어 있거나 `<<<<<<<`, `=======`, `>>>>>>>` conflict marker를
  포함하면 `400 Bad Request`를 반환한다.
- 각 PR head 파일 전체 content가 apply 크기 제한을 초과하면 `400 Bad Request`를 반환한다.
- 서버는 격리된 임시 Git working tree에서 PR head commit을 checkout하고 base commit을
  `--no-commit --no-ff`로 실제 merge한다. 이 과정에서 충돌 없이 합쳐지는 base 변경도 결과에
  포함해야 한다.
- 서버는 사용자가 확인한 모든 `resolvedContent`를 해당 파일에 기록한 뒤 미해결 경로가 0개인지
  확인하고, `[PR head SHA, base SHA]` 두 parent를 갖는 merge commit을 만든다. commit message는
  단일 파일이면 `Resolve conflict in {filePath}`, 다중 파일이면
  `Resolve conflicts in {fileCount} files` 형식으로 생성한다.
- push 직전에 원격 PR head SHA와 base branch SHA가 분석 시점과 같은지 확인하고, force 없이
  PR head branch를 갱신한다. 임시 working tree는 성공/실패와 관계없이 삭제한다.
- apply 성공 후 GitHub PR head SHA와 conflict 상태를 다시 조회한다. GitHub가 새 merge
  commit의 mergeability를 계산 중이라 `checking`을 반환하면 짧은 간격으로 제한된 횟수만
  재확인한다.
- apply 성공 후 `pr_review_sessions.head_sha`, `conflict_status`, `conflict_checked_at`은
  새 PR head 기준으로 갱신한다. 이 갱신은 PILO apply commit 성공 후에만 허용한다.
- 제한된 재확인 뒤에도 `checking`이면 해당 상태를 응답하고 저장한다. PR Review room은
  `summary`를 제한적으로 다시 조회하며 GitHub 계산이 끝나면 Merge 활성화 상태를 갱신한다.
- GitHub PR head branch 갱신은 성공했지만 conflict 상태 재조회, PILO의 PR cache 또는
  review session 갱신이 실패하면
  endpoint는 GitHub 성공을 실패로 응답하지 않는다. `status: "applied"`와
  `localStateStatus: "sync_required"`를 반환해 GitHub 동기화와 새 review session이 필요함을
  알린다. conflict 상태 재조회 자체가 실패한 경우 `conflictStatus: "unknown"`과
  `conflictCheckedAt: null`을 반환한다. 모든 local 갱신이 성공하면
  `localStateStatus: "updated"`를 반환한다.
- GitHub branch 갱신 전에 head/base SHA가 바뀌거나 fast-forward가 거절되면
  `409 Conflict`를 반환한다.
- `review_files.current_status`, `file_review_decisions`, `review_submissions`를 변경하지 않는다.
- GitHub merge API 호출, PR close, review submission은 이 endpoint의 범위가 아니다.

## 파일별 Review Decision 저장

```json
{
  "status": "discussion_needed",
  "comment": "Need to confirm empty state behavior."
}
```

서버는 `review_files.current_status/comment`를 갱신하고
`file_review_decisions` row를 추가한다.

PATCH response는 Review File 상세 조회와 같은 payload를 반환한다.

Decision history response:

```json
{
  "success": true,
  "data": {
    "reviewFileId": "review_file_1",
    "decisions": [
      {
        "id": "decision_1",
        "reviewFileId": "review_file_1",
        "status": "discussion_needed",
        "comment": "Need to confirm empty state behavior.",
        "reviewedByUserId": "user_1",
        "reviewedAt": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

## GitHub Review 제출

```json
{
  "submitType": "COMMENT",
  "reviewBody": "## PILO PR Review\n\nSummary..."
}
```

서버 규칙:

- 사용자의 GitHub App user OAuth 연결 여부를 확인한다.
- GitHub OAuth token 복호화와 GitHub Review body 제출은 GitHub Integration의
  서버 내부 dependency를 통해 수행하며, PR Review API 응답에는 token 값을 노출하지 않는다.
- 현재 PR head SHA를 다시 조회해 session `headSha`와 비교한다.
- GitHub OAuth 미연결, stale head SHA, 분석/파일 생성이 끝나지 않은 session은 제출 전 guard
  실패로 보고 `review_submissions` row를 만들지 않는다.
- `not_reviewed` file이 남아 있어도 GitHub Review 제출은 가능하다.
- 실제 GitHub 제출 단계에 진입한 뒤의 성공/실패 시도만 `review_submissions`에 저장한다.
- GitHub Review 제출에는 GitHub App `Pull requests: write` permission이 필요하다.
- GitHub Review 제출 403 응답은 generic failure가 아니라 권한 부족 에러로 구분해
  sanitize된 message만 저장/응답한다.
- GitHub Review body만 제출한다.
- Line comment payload는 보내지 않는다.
- 실제 GitHub 제출 시도는 `review_submissions`에 저장한다.
- 화면 이탈로 session이 삭제되면 해당 local submission history도 함께 삭제된다.

제출 성공 응답:

```json
{
  "success": true,
  "data": {
    "id": "review_submission_uuid",
    "sessionId": "review_session_uuid",
    "submitType": "REQUEST_CHANGES",
    "reviewBody": "## PILO PR Review\n\nSummary...",
    "reviewResultSummary": "문제 없음 1개 / 논의·수정 필요 1개 / 판단 불가 0개 / 미리뷰 0개",
    "fileReviewResults": [
      {
        "fileName": "VoiceMeetingPage.tsx",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "status": "discussion_needed",
        "comment": "Need to confirm empty state behavior."
      }
    ],
    "githubSubmitStatus": "submitted",
    "githubReviewId": "123456789",
    "githubReviewUrl": "https://github.com/my-team/pilo/pull/24#pullrequestreview-123456789",
    "submittedByUserId": "user_uuid",
    "submittedByGithubLogin": "octocat",
    "errorMessage": null,
    "submittedAt": "2026-07-06T12:00:00.000Z",
    "createdAt": "2026-07-06T11:59:58.000Z",
    "updatedAt": "2026-07-06T12:00:00.000Z"
  }
}
```

Session submission history response:

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "submissions": [
      {
        "id": "review_submission_uuid",
        "sessionId": "review_session_uuid",
        "submitType": "REQUEST_CHANGES",
        "githubSubmitStatus": "failed",
        "githubReviewId": null,
        "githubReviewUrl": null,
        "submittedByUserId": "user_uuid",
        "submittedByGithubLogin": "octocat",
        "errorMessage": "GitHub App Pull requests write permission is required",
        "submittedAt": null,
        "createdAt": "2026-07-06T11:59:58.000Z",
        "updatedAt": "2026-07-06T11:59:59.000Z"
      }
    ]
  }
}
```

`GET /workspaces/{workspaceId}/github/review-submissions/{submissionId}`는 제출 성공 응답과
같은 detail payload를 반환한다.

## GitHub PR Merge 실행

Post-MVP Phase 1-F에서 구현하는 사용자 확인 기반 PR merge 실행 계약이다.
이 endpoint는 GitHub Review 제출 완료 후 PR Review room에서 GitHub PR merge API를 호출한다.
merge 방식은 1차에서 `merge` commit만 지원하며, `squash`, `rebase`, head branch 삭제는 수행하지 않는다.

```http
POST /api/v1/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/merge
```

요청 body:

```json
{
  "expectedHeadSha": "abc123",
  "confirm": true
}
```

응답:

```json
{
  "success": true,
  "data": {
    "reviewSessionId": "review_session_uuid",
    "pullRequestId": "pull_request_uuid",
    "status": "merged",
    "mergedByGithubLogin": "octocat",
    "mergeMethod": "merge",
    "mergeCommitSha": "merge_commit_sha",
    "mergeCommitUrl": "https://github.com/my-team/pilo/commit/merge_commit_sha",
    "pullRequestState": "closed",
    "mergedAt": "2026-07-10T00:00:00.000Z",
    "headSha": "abc123"
  }
}
```

서버 규칙:

- 현재 사용자는 review session이 속한 Workspace에 접근할 수 있어야 한다.
- 요청 body는 `confirm: true`와 `expectedHeadSha`를 포함해야 한다.
- review session status가 `submitted`여야 한다. GitHub Review 제출 전 merge는 허용하지 않는다.
- Merge 실행 직전에 GitHub의 최신 conflict 상태를 제한적으로 재확인하고 같은 session
  `headSha`가 유지되는 경우 `pr_review_sessions`에 저장한다.
- 재확인한 `conflictStatus`가 `clean`이어야 한다. 오래된 local `checking` 값만으로 정상 PR을
  차단하거나, 오래된 local `clean` 값만으로 Merge를 허용하지 않는다.
- review file 판단 완료 여부는 merge hard guard가 아니다. `not_reviewed` 파일이
  남아 있어도 사용자가 확인하면 merge를 시도할 수 있다.
- review session `headSha`와 요청 `expectedHeadSha`가 다르면 stale session으로 보고 `409 Conflict`를 반환한다.
- GitHub App user OAuth 연결이 필요하며, 실제 merge는 현재 사용자의 OAuth token으로 수행한다.
- GitHub 원격 PR state가 `open`이 아니거나 head SHA가 stale이면 merge를 막는다.
- GitHub 원격 PR `mergeable`이 `false`이면 conflict로 보고 merge를 막는다. `null`이면 GitHub mergeability 계산 중으로 보고 재시도를 안내한다.
- Branch protection, required checks, required reviews, conversation resolution, merge method 제한은 PILO가 사전 판정하지 않고 GitHub merge API 응답을 안전한 API error로 매핑한다.
- merge 성공 후 `github_pull_requests` cache의 PR state, merged timestamp, head SHA, mergeable 상태를 갱신한다.
- review session status는 별도 `merged` 상태로 바꾸지 않고 기존 `submitted` 상태를 유지한다.
- GitHub token, raw provider error, secret은 API 응답이나 로그에 노출하지 않는다.

## MVP 제외

- GitHub inline review comment
- PR close without merge
- PR head branch delete after merge
- MVP에서 AI 생성 flow graph 편집
