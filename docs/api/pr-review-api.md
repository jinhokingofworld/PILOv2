# PR Review API

## 범위

PR Review API는 다음 기능을 담당한다.

- PR별 공유 리뷰 공간 생성, 합류, 조회, 영구 삭제
- head SHA별 Review session(revision) 생성과 조회
- AI가 생성한 PR 목적, 변경 요약, 주의점, flow, file review order와 검증된 semantic relation 저장과 조회
- Review file metadata와 파일별 review decision
- PR 리뷰 화면용 canvas view model
- Side-by-side diff view model
- GitHub Review 제출과 제출 이력

GitHub 원본 동기화, GitHub PR 원본 조회, GitHub inline comment, ProjectV2 write는 이
문서의 범위가 아니다.

## GitHub Integration과의 경계

| 필요 기능 | 담당 API |
| --- | --- |
| Open PR 목록 | GitHub Integration |
| PR 상세 | GitHub Integration |
| PR 변경 파일과 patch | GitHub Integration |
| PR conflict 상태 | GitHub Integration |
| PR conflict resolution apply commit | PR Review + GitHub Integration 내부 dependency |
| 사용자 GitHub OAuth 연결 상태 | GitHub Integration |
| Review room, revision, flow, file decision, submission | PR Review |
| `board_type=review` Canvas와 사용자 배치 데이터 | Canvas |

## 데이터 규칙

- 같은 Workspace의 같은 PR에는 공유 Review room과 `board_type=review` Canvas가 하나씩 존재한다.
- Review session은 room 안에서 특정 PR head SHA를 분석한 불변 revision이다.
- 분석 중 새 revision은 마지막 성공 revision을 대체하지 않는다. 분석 결과 저장이 모두 성공한 뒤에만
  room의 `currentReviewSessionId`를 새 revision으로 교체한다.
- 같은 room/head SHA의 `failed`가 아닌 revision은 하나만 존재하고, room당 `analyzing` revision도
  하나만 존재한다.
- room 삭제 시 모든 revision, flow, file, semantic relation, file decision, submission history와
  연결된 Review Canvas가 FK cascade로 함께 영구 삭제된다.
- `review_submissions`는 화면 안에서 제출 결과와 실패 원인을 확인하기 위한 세션 내부 이력이다.
- `review_files`는 file metadata와 review state를 저장한다.
- Diff 응답은 GitHub Integration을 통해 PR 변경 파일과 patch 정보를 조회해 만든다.
- PR 리뷰 graph view model의 원본은 `review_flows`, `review_files`, `review_flow_files`,
  `review_flow_relations`이며, 사용자 배치와 annotation을 저장할 Review Canvas는 `canvas`에
  `board_type=review`로 연결한다.
- `review_flow_files`는 같은 review session에 속한 `review_flows`와 `review_files`만 연결한다.
- `review_flow_relations`는 같은 review session과 Flow에 속한 두 `review_flow_files` membership만 연결한다.
- Semantic Graph v2는 App Server와 AI Worker 사이의 내부 분석 계약이다. 공개 PR Review
  endpoint와 Canvas response shape, `review_flows`/`review_flow_files`/`review_flow_relations`
  schema는 바꾸지 않는다.
- v2 분석은 `meetingId`, `recordingId` 등 Meeting 소유 필드를 요청, 결과, Activity Log metadata에
  추가하지 않는다.
- GitHub Review 제출은 GitHub Integration에서 연결한 현재 사용자의 GitHub App user OAuth token으로 수행하며 review body만 제출한다.
- 현재 GitHub PR head SHA가 session의 `headSha`와 다르면 제출을 막는다.
- Conflict resolution apply는 현재 사용자의 GitHub App user OAuth token으로 PR head branch에
  하나 이상의 content conflict 파일을 해결한 단일 merge commit을 만든다.
- Conflict resolution apply로 새 PR head가 생겨도 기존 revision의 `headSha`는 바꾸지 않는다.
  같은 room에 새 head SHA의 successor revision과 분석 Job을 생성한다.
- Conflict resolution apply는 file review decision, review submission history, PR merge 상태를
  변경하지 않는다.

## Server-side Activity Log 규칙

이 규칙은 서버 내부 append-only 활동 기록에만 적용되며 기존 외부 request/response shape는 변경하지 않는다.
PR Review service는 의미 있는 사용자 행동이 commit되는 DB transaction에서 공통
`ActivityLogService.append`를 호출하고 `activity_logs`에 직접 `INSERT`하지 않는다.

| 사용자 행동 | 기록하는 action | 기록하지 않는 no-op/중간 상태 |
| --- | --- | --- |
| 새 review revision 생성 | `pr_review_session_created` | 기존 room 합류와 같은 head revision 재사용 |
| file decision 변경 | `file_review_decision_created` | status와 comment가 모두 같은 저장 요청 |
| GitHub Review 제출 terminal 결과 | 성공 `review_submission_submitted`, 실패 `review_submission_failed` | 제출 시도 생성과 `submitting` 중간 상태 |
| conflict resolution apply 성공 | `pr_review_conflict_resolution_applied` | suggestion/draft 저장, conflict 조회와 상태 재확인 |
| GitHub PR merge 성공 | `pr_review_pull_request_merged` | merge 사전조건 거절과 GitHub merge 실패 |

- 새 revision만 기록하며 기존 room 합류와 기존 revision 재사용은 Activity Log를 기록하지 않는다.
- 실제 file decision 변경만 기록한다. 동일한 status와 comment를 다시 저장한 no-op은 기록하지 않는다.
- file decision 기록은 repo-relative file path와 review file ID를 metadata에 포함하고, 같은 bounded
  path를 `summary`에 넣어 MeetingReport 활동 근거에서 어떤 파일인지 식별할 수 있게 한다. path는
  한 줄 최대 400자로 제한하며 긴 값은 파일명을 포함한 suffix를 보존한다. 기존 Activity Log와
  MeetingReport snapshot은 소급 보강하지 않는다.
- submission 성공/실패 terminal 결과만 기록한다. 제출 시도와 `submitting` 상태는 기록하지 않는다.
- conflict apply와 PR merge 성공 결과를 기록한다. 조회, AI suggestion, draft 편집은 기록하지 않는다.
- PR Review는 `meetingId`와 `recordingId`를 소유하지 않으며 요청이나 Activity Log metadata에 저장하지 않는다.
- 민감 정보나 원문 payload를 metadata에 저장하지 않는다. GitHub/OAuth token, raw provider error,
  review body, file decision comment, conflict `resolvedContent`, diff/patch 원문은 금지한다.

stable dedupe key는 재시도에도 바뀌지 않는 commit 결과의 식별자로 만든다.

| action | stable dedupe 기준 |
| --- | --- |
| `pr_review_session_created` | 생성된 review session ID |
| `file_review_decision_created` | 실제 저장된 decision row ID |
| `review_submission_submitted`, `review_submission_failed` | submission ID와 terminal 결과 |
| `pr_review_conflict_resolution_applied` | pull request ID와 conflict apply commit SHA |
| `pr_review_pull_request_merged` | pull request ID와 merge commit SHA |

외부 GitHub mutation과 PILO DB transaction은 하나의 원자적 transaction이 아니다.

- conflict apply의 GitHub head branch 갱신 뒤 conflict 재조회, cache 갱신 또는 successor revision 생성이
  실패해도 GitHub commit은 되돌릴 수 없다. 이 local sync 실패는 기존 계약대로
  `status: "applied"`, `localStateStatus: "sync_required"`로 반환한다. Activity Log append 자체가
  실패한 경우에는 이를 `sync_required`로 숨기지 않고 API error로 응답하며, conflict apply commit
  SHA를 복구와 dedupe 식별자로 사용한다.
- GitHub PR merge가 성공한 뒤 후속 local room/activity transaction이 실패할 수 있다.
  이 실패는 숨기지 않고 API error로 응답한다. GitHub에는 PR이 이미 merged 상태일 수 있으며,
  merge commit SHA는 복구와 dedupe 식별자로 사용한다.

## 상태값

| Field | Values |
| --- | --- |
| `reviewRoom.status` | `active`, `completed` |
| `reviewRoom.completionReason` | `merged`, `closed`, `null` |
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
| `GET` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-room` | PR의 공유 Review room 조회 |
| `POST` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-room` | 공유 room 생성 또는 합류와 최신 revision 시작 |
| `GET` | `/workspaces/{workspaceId}/github/review-rooms` | Workspace의 Review room 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}` | Review room 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}/revisions` | room의 revision 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}/revisions` | 최신 PR head revision 생성 또는 재사용 |
| `DELETE` | `/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}` | Review room과 연결 Canvas 영구 삭제 |
| `POST` | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-sessions` | 최신 revision 생성 호환 endpoint |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/retry` | Post-MVP 실패한 비동기 분석을 새 session으로 재시도 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 상세 조회 |
| `PATCH` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 상태 수정 |
| `DELETE` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | 해당 revision이 속한 Review room 영구 삭제 호환 endpoint |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/summary` | PR 요약 패널 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/result` | 전체 리뷰 결과 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/canvas` | 리뷰 canvas view model 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflicts` | Post-MVP read-only conflict 분석 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflict-apply` | Post-MVP 다중 conflict 해결안을 하나의 merge commit으로 적용 |
| `POST` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-suggestion` | Post-MVP AI conflict 해결 초안 생성 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-draft` | 공유 conflict 해결 코드 초안 조회 |
| `PATCH` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-draft` | 공유 conflict 해결 코드 초안 저장 |
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

## 공유 Review Room

### PR 기준 room 조회

```http
GET /api/v1/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-room
```

room이 없으면 `404`를 반환한다.

### room 생성 또는 합류

```http
POST /api/v1/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-room
```

같은 Workspace/PR room이 없으면 Review Canvas, room, 첫 revision과 분석 Job을 생성해
`201 Created`를 반환한다. room이나 같은 head revision이 이미 있으면 재사용하며, 새 revision을
만들지 않은 경우 `200 OK`를 반환한다.

GitHub Integration이 동기화한 PR 상태가 `closed`이거나 `merged_at`, `github_closed_at`이
기록된 경우 새 room 또는 revision을 만들지 않고 `409 Conflict`를 반환한다. 이 endpoint는
GitHub에 PR 상태를 직접 재조회하지 않고 동기화된 `github_pull_requests` read model을 사용한다.

```json
{
  "room": {
    "id": "review_room_uuid",
    "workspaceId": "workspace_uuid",
    "pullRequestId": "pull_request_uuid",
    "canvasId": "review_canvas_uuid",
    "currentReviewSessionId": null,
    "analyzingReviewSessionId": "review_session_uuid",
    "status": "active",
    "completionReason": null,
    "revisionCount": 1
  },
  "revision": {
    "id": "review_session_uuid",
    "reviewRoomId": "review_room_uuid",
    "headSha": "abc123",
    "status": "analyzing"
  },
  "roomCreated": true,
  "revisionCreated": true
}
```

### room 목록, 상세와 revision

- `GET /review-rooms`는 active room을 먼저, 같은 상태에서는 최근 갱신 순으로 반환한다.
- `GET /review-rooms/{reviewRoomId}`는 현재 성공 revision과 분석 중 revision ID를 함께 반환한다.
- `GET /review-rooms/{reviewRoomId}/revisions`는 최신 생성 순 revision 이력을 반환한다.
- `POST /review-rooms/{reviewRoomId}/revisions`는 현재 GitHub head를 분석한 revision을 생성하거나
  이미 존재하는 `failed`가 아닌 revision을 반환한다. 완료 room 또는 동기화된 PR이 종료된
  상태에서는 `409`를 반환한다.

## Review Session 생성 호환 endpoint

```json
{}
```

성공 응답은 `201 Created`다. 분석 자체는 비동기로 진행하므로 응답은 분석 결과가 없는
최소 session을 즉시 반환한다.

```json
{
  "id": "review_session_uuid",
  "reviewRoomId": "review_room_uuid",
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
- 첫 요청이면 `board_type=review` Canvas와 room, session, `pr_review_analysis_jobs` row를 하나의
  DB transaction으로 저장한다.
  `pr_review_analysis_jobs`는 job 자체와 durable outbox 발행 상태를 함께 보관하므로 별도
  outbox table을 만들지 않는다.
- transaction이 끝난 뒤 outbox publisher가 전용 SQS에 job을 발행한다. 발행 실패는 HTTP
  응답을 실패로 바꾸지 않으며, session은 `analyzing`으로 남아 발행 재시도 또는 terminal
  failure를 기다린다.
- 같은 room에 `analyzing` session이 있거나 같은 head SHA의 `failed`가 아닌 session이 있으면
  새 job을 만들지 않고 기존 session을 `200 OK`로 반환한다. 이 규칙은 사용자별이 아니라
  Workspace의 공유 room 기준이다.
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
    "graphSchemaVersion": "pr-review-semantic-graph:v2",
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
    ],
    "semanticGraph": {
      "files": [
        {
          "filePath": "apps/app-server/src/pr-review.ts",
          "roleType": "core_logic",
          "confidence": 65,
          "evidence": "code_file_fallback",
          "roleOverrideAllowed": true
        }
      ],
      "relations": [],
      "flows": [
        {
          "key": "candidate-flow-fallback",
          "title": "기타 변경",
          "filePaths": ["apps/app-server/src/pr-review.ts"],
          "relationKeys": [],
          "fallback": true
        }
      ]
    }
  }
}
```

`graphSchemaVersion`과 `semanticGraph`는 Semantic Graph 보강을 지원하는 Worker가 사용하는
additive internal contract다. v1과 v2를 모두 수용하며, 새 분석 요청은 v2를 보낸다. 둘 중
하나만 있거나 지원하지 않는 version이면 입력을 거부한다. Graph 필드가 모두 없는 구형
결과는 v1 호환 deterministic fallback으로 처리한다.

### Semantic Graph v1/v2 내부 계약

- v1 (`pr-review-semantic-graph:v1`)은 기존 호환 경로다. AI는 입력 candidate Flow의
  `candidateKey`를 정확히 하나씩 반환하고, 각 `reviewOrder`는 그 candidate의 file membership을
  정확히 한 번씩 그대로 포함해야 한다. AI가 파일을 다른 Flow로 옮기거나 candidate Flow를
  합치거나 나눌 수 없다.
- v2 (`pr-review-semantic-graph:v2`)는 AI regrouping 경로다. 변경 파일이 하나 이상이면 Flow는
  1개 이상 `min(8, changed file count)`개 이하여야 하며, 전체 `reviewOrder`가 모든 변경 파일을
  정확히 한 번씩 partition해야 한다. v2 Flow output에는 `candidateKey`를 넣지 않는다.
- 변경 파일이 0개면 v2 AI Flow 배열은 빈 배열이어야 한다. App Server는 화면 호환을 위해
  membership/relation이 없는 빈 fallback Flow 하나를 저장한다.
- App Server는 확정된 v2 Flow의 정렬된 membership으로 SHA-256 digest를 계산해 안정적인 내부
  `candidateKey`를 만든다. 이 key는 재시도나 AI가 Flow를 나열한 순서가 달라도 같은 membership이면
  같으며, 저장 과정에서 Flow/membership/relation을 연결할 때만 사용한다. DB schema나 공개
  response field는 아니다.

v2 relation candidate에는 Flow 경계 강제 여부를 나타내는 `groupingBinding`이 추가된다.

| Binding | Evidence | 규칙 |
| --- | --- | --- |
| `locked` | `matching_test_filename`, `package_lock_manifest` | 같은 연결 요소의 파일은 반드시 같은 Flow에 있어야 한다. AI가 relation 배열에서 생략해도 App Server가 같은 Flow 안의 rule relation으로 합성한다. |
| `hint` | `relative_import:*`, `explicit_file_reference`, `shared_identifier:*` | Flow 분류와 semantic relation 제안의 근거일 뿐 Flow를 강제로 합치지 않는다. |

v2 deterministic candidate Flow는 `locked` relation만 union해서 만든다. 고립 파일은 fallback
candidate에 모일 수 있지만 AI membership의 고정 틀은 아니다. `hint`가 서로 다른 Flow에 걸치면
그 relation은 저장하거나 Canvas edge로 표시하지 않는다.

`roleOverrideAllowed`는 `roleType = unknown`이거나 `confidence < 85`일 때만 `true`다.
AI는 값이 `false`인 파일의 `roleType`을 변경할 수 없다. `evidence`에는 raw patch나 전체
code를 넣지 않고 규칙 이름 또는 제한된 식별자만 전달한다.

Worker의 strict output schema는 요청마다 Graph 입력을 기준으로 동적으로 생성한다. Graph
file path와 relation endpoint는 입력 변경 파일 집합으로 제한한다. relation `candidateKey`는
입력 relation key 또는 `null`이며, AI가 기존 relation을 보강할 때는 입력 key를 그대로 쓰고
새 relation을 제안할 때만 `candidateKey = null`을 사용한다. self relation과 동일
endpoint/type 중복 relation은 허용하지 않는다. v1 Flow만 입력 Flow key의 `candidateKey`를
반환한다. v2 Flow에는 `candidateKey`가 없으며 Worker는 파일 전체 포함, 빈/중복/알 수 없는
파일, 최대 Flow 수 같은 전송 가능한 구조만 확인한다. locked component 보존과 relation의 최종
저장 가능 여부는 App Server가 판정한다.

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
    ],
    "graphSchemaVersion": "pr-review-semantic-graph:v2",
    "semanticGraph": {
      "files": [
        {
          "filePath": "string",
          "roleType": "entry | core_logic | api_contract | ui_state | verification | support | unknown",
          "roleReason": "string"
        }
      ],
      "relations": [
        {
          "candidateKey": "string | null",
          "fromFilePath": "string",
          "toFilePath": "string",
          "relationType": "depends_on | tests | uses_api | passes_data_to | supports",
          "reason": "string"
        }
      ],
      "flows": [
        {
          "title": "string",
          "description": "string",
          "reviewOrder": ["filePath"]
        }
      ]
    }
  }
}
```

Graph 입력을 받은 Worker는 결과에도 같은 `graphSchemaVersion`과 `semanticGraph`를 포함한다.
기존 `flowTitle`, `flowDescription`, `files`는 App Server와 Worker의 독립 배포 호환성을 위해
유지한다. Graph 입력이 없는 구형 요청은 Graph 결과 없이 기존 결과 형식만 반환한다.

Worker parser는 v1/v2 모두에서 strict schema, enum, 알려진 file path, 잠긴 역할과 전송 가능한
Flow membership을 검사한다. 기존 PR 요약·파일 분석은 유효하지만 Graph 구조가 유효하지 않으면
Worker는 raw AI 값이나 파일 경로를 로그에 남기지 않고 안전한 category/reason만 기록하고 Graph
필드 없이 기존 분석 결과를 App Server에 전달한다. 기존 PR 요약 또는 파일 분석 자체가 유효하지
않은 경우에만 기존처럼 `ANALYSIS_INPUT_INVALID` terminal failure로 처리한다.

App Server Validator는 Worker 검증을 통과한 결과도 최종 검사한다. v1은 candidate Flow와의
정확한 대응을 다시 확인하고, v2는 파일 전체 partition, Flow 개수, locked component 보존을
확정한 뒤 내부 membership hash key를 만든다. 기존 relation 후보를 AI가 정확히 보강하면 기존
confidence와 `source = hybrid`를 사용하고, AI가 새로 제안한 relation은 `confidence = 60`,
`source = ai`를 사용한다. `confidence < 60` relation은 제거한다. Flow별 relation은
`min(file count * 2, 40)`, PR 전체 relation은 `100`개로 제한한다. 의미 relation cycle은
허용한다.

v2의 version, 파일, 잠긴 역할 또는 Flow 검증이 실패하면 App Server는 AI Graph 전체를 폐기하고
같은 입력의 deterministic Graph 전체를 사용한다. 반대로 Flow가 유효하고 relation만 invalid이면
AI가 만든 Flow, 파일 역할, Flow 순서와 `workflowOrder`는 유지한다. AI relation 전체만 폐기하고
각 확정된 동일 Flow 안의 deterministic relation으로 대체한다. cross-Flow relation(특히
cross-Flow hint)은 저장하지 않는다. 검증된 복수 Flow와 same-Flow relation만 DB 저장 대상이다.

검증 결과는 review file을 session에 한 번 저장한 뒤 복수 Flow와 Flow별 membership을 만들고,
relation endpoint를 같은 Flow의 membership ID로 변환해 저장한다. `review_files.role_type`에는
검증된 정규화 역할을, 기존 `file_role`에는 기존 AI 설명 문자열을 유지한다. Flow의
`sort_order`와 membership의 `workflow_order`는 검증된 Flow·review order 순서를 사용한다.
변경 파일이 0개면 기존 화면 호환을 위해 membership과 relation이 없는 빈 fallback Flow
하나를 저장한다.

App Server는 현재 GitHub head SHA, Job head SHA, session head SHA를 다시 비교한다.
셋 중 하나라도 다르면 flow/file을 만들지 않고 Job과 session을
`failed(PR_HEAD_CHANGED)`로 끝낸다. 일치하면 summary, flow, file, flow-file, relation과
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

Worker는 `pr_review_analysis_requested`와 `pr-review-analysis:v1`을 수용한다. Graph 입력과
결과의 schema version은 v1 또는 v2여야 하며 Worker는 입력 version을 그대로 보존한다.
malformed payload, input 불일치, strict output의 빈 핵심 필드·누락/중복 file path·잘못된
risk level은 terminal 처리한다. timeout, rate limit, provider 5xx, internal handoff network/5xx
오류는 SQS 재수신 대상으로 남긴다. Worker는 DB에 직접 결과를 쓰지 않고, 검증한 분석 결과만
`result` internal endpoint로 전달한다.

결과 저장은 session이 여전히 `analyzing`이고 job/session/current GitHub head SHA가 모두 같은
경우에만 수행한다. 저장 transaction의 마지막 단계에서 session을 `reviewing`으로 전환한다.
동일 job의 SQS 재전달 또는 result 재전송은 이미 성공한 결과를 그대로 인정하며 새 flow/file을
만들지 않는다.

outbox 발행은 1, 2, 4, 8, 16분 간격으로 최대 5회 재시도한다. Worker의 timeout, rate limit,
provider 5xx와 handoff 일시 오류는 SQS receive count 3회까지 재시도한다. 각 재시도 소진 시
App Server가 session을 해당 안전한 `failed` reason code로 전환한 뒤 메시지를 terminal 처리한다.

### v1/v2 유지보수 배포 순서

v2 전환 중에는 PR Review 사용을 중지하고 analysis queue에 진행 중인 Job이 없는지 확인한다.
queue가 비어 있는 상태에서 v1/v2 입력·결과를 모두 수용하는 AI Worker를 먼저 배포하고,
그 다음 v1/v2 결과를 수용하며 새 요청에는 v2를 보내는 App Server를 배포한다. 두 runtime의
health check가 성공한 뒤에만 PR Review 사용을 재개한다.

```text
PR Review 사용 중지 + queue empty 확인 → AI Worker → App Server → health check → 사용 재개
```

새 App Server를 구 Worker보다 먼저 배포하지 않는다. 이번 전환에는 별도 capability negotiation,
feature flag, DB migration, Frontend 배포 순서 의존성이 없다.

### OpenAI 분석 계약

PR Review 전용 Worker는 Responses API의 strict JSON schema `pr_review_analysis`를 사용한다.
모델은 `OPENAI_PR_REVIEW_MODEL`을 사용하고, 값이 없으면 `gpt-5.1-mini`를 사용한다. Worker의
provider timeout은 `OPENAI_PR_REVIEW_TIMEOUT_MS`로 설정하며 기본값은 180초다. OpenAI SDK의
내부 재시도는 사용하지 않고, timeout·rate limit·provider 5xx 재시도는 SQS receive 경계에서만
수행한다. PR Review 전용 worker runtime은 `SQS_PR_REVIEW_ANALYSIS_QUEUE_URL`,
`PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL`, `PR_REVIEW_ANALYSIS_WORKER_TOKEN`을 별도로 사용한다. 이 분석 계약은
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

## Review Room 영구 삭제

모든 Workspace 구성원이 공유 리뷰 공간을 영구 삭제할 때 호출한다.

```http
DELETE /api/v1/workspaces/{workspaceId}/github/review-rooms/{reviewRoomId}
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

- room의 모든 revision과 `review_flows`, `review_files`, `review_flow_files`,
  `review_flow_relations`가 함께 삭제된다.
- `file_review_decisions`는 `review_files` 삭제에 의해 함께 삭제된다.
- `review_submissions`는 revision 삭제와 함께 삭제된다.
- 연결된 Review Canvas와 shape, operation, user state도 함께 삭제된다.
- 삭제 SQL이 완료된 뒤 realtime-server로 `pr-review:room:deleted` event를 발행한다.
  현재 room에 접속한 클라이언트는 event의 `workspaceId`, `canvasId`, `reviewRoomId`가
  자신이 연 Canvas와 일치할 때 로컬 편집을 중단하고 PR Review 목록으로 이동한다.
- event 발행 실패는 이미 완료된 DB 삭제를 되돌리지 않는다. realtime 연결이 없던
  클라이언트는 다음 조회에서 `404`를 받아 목록으로 돌아간다.
- `DELETE /review-sessions/{reviewSessionId}`는 전환 기간의 호환 endpoint이며 해당 revision 하나가
  아니라 그 revision이 속한 room 전체를 같은 방식으로 삭제한다.

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

Review room의 Canvas에는 다음 시스템 shape 계약을 사용한다.

### `pr_review_file_node`

- stable shape ID: `shape:pr-review-file:{roomFileId}`
- identity: `reviewRoomId`, `roomFileId`
- 현재 버전 참조: `currentReviewSessionId`, `reviewFileId`
- PR Review 소유 metadata: file path/status, role, risk, review status, Conflict 상태
- Canvas 소유 geometry: 위치, 크기, parent/group, 표시 순서

기존 session graph 호환 필드인 `reviewSessionId`, `reviewFlowFileId`, `flowId`,
`workflowOrder`는 Materialization 전환 기간에 유지한다. 새 버전에서 같은 room file은
같은 stable shape ID와 저장된 geometry를 재사용한다.

### `pr_review_relation_edge`

- stable shape ID는 room file pair와 relation type으로 결정한다.
- identity: `reviewRoomId`, `currentReviewSessionId`, `fromRoomFileId`, `toRoomFileId`
- relation metadata: `relationType`, `source`, `confidence`, `reason`
- endpoint와 relation metadata, edge geometry는 PR Review가 소유한다.
- edge geometry는 `startX`, `startY`, `endX`, `endY`와 순서가 있는
  `routePoints: [{ x, y }, ...]`로 표현한다. point는 edge shape 좌상단 기준 상대 좌표다.
- 저장된 file node geometry가 없는 새 Review Canvas의 최초 materialization은 App Server의
  ELK layered layout으로 file node 좌표와 orthogonal route를 계산한다. ELK 오류 또는 timeout이면
  deterministic grid와 기본 꺾은선 route로 fallback한다.

일반 사용자는 시스템 shape를 생성·삭제할 수 없다. File node의 geometry만 변경할 수
있고 relation edge는 수정할 수 없다. 분석 성공 시 PR Review가 graph와 같은 transaction
안에서 시스템 shape를 생성·갱신한다. 최초 빈 Canvas에서는 Flow 내부 파일을 `workflowOrder`,
file path, stable ID 순으로 정렬하고 첫 파일을 layout start로 둔다. `review_order` relation은
rank에서 제외하며, semantic endpoint pair만 낮은 `workflowOrder`에서 높은 순서로 정규화해
ELK에 전달한다. 실제 relation 방향과 저장 값은 바꾸지 않는다. semantic root는 첫 파일의
synthetic anchor로 연결하고, semantic relation이 없는 Flow만 1→2→3 spine을 fallback으로
사용한다. semantic relation은 배치 뒤 node 아래쪽 orthogonal lane에 route하며, 다음 Flow
간격에는 사용한 route 높이를 반영한다. 따라서 첫 파일은 가장 왼쪽에 남고 나머지 파일은
semantic 관계의 branch와 depth에 따라 같은 rank에서 위아래로 배치될 수 있다.

같은 room file은 기존 위치·크기·parent·표시 순서와 저장된 relation edge route를 유지한다.
즉, 최초 materialization이나 새 revision 분석은 이미 저장된 file node geometry와 route를
덮어쓰지 않으며, 저장된 file node가 없는 최초 Canvas에만 위 자동 배치를 적용한다. 이후 새
file node는 기존 deterministic grid 초기 위치를 받는다. 현재 버전에서 사라진
시스템 shape는 soft delete로 숨기며, 이후 다시 나타나면 마지막 geometry로 복원한다.

Review Canvas frontend는 room 상세의 `canvasId`로 Canvas viewport Shape API를 호출한다.
저장된 `pr_review_file_node`가 있으면 시스템 Shape를 우선 렌더링하고, Materialization 전
기존 session처럼 저장 Shape가 없거나 조회에 실패하면 이 endpoint의 graph로 read-only
layout을 구성한다. File node 이동은 Canvas 단일 Shape 수정 API에 `baseRevision`을 포함해
저장하며, relation edge geometry는 저장 요청을 만들지 않고 이동한 node 위치를 따라
클라이언트에서 기본 orthogonal route로 다시 계산한다. `409 CONFLICT` 응답 시 최신 Shape를 다시 조회해 화면을
저장 상태로 복구한다.

Frontend의 명시적 `현재 Flow 자동 정렬`도 pin되지 않은 node 사이의 semantic endpoint pair를
`workflowOrder` 순으로 정규화해 Dagre rank에 사용한다. semantic root는 이동 가능한 첫 node의
synthetic anchor로 연결하고, semantic relation이 없는 Flow만 review-order spine으로 fallback한다.
사용자가 자동 정렬을 실행하면 현재 Flow의 pin되지 않은 모든 node를 새 좌표로 재배치하고 그
geometry를 저장한다. 따라서 pin되지 않은 node의 기존 저장 geometry는 이 명시적 동작으로
의도적으로 대체되며, pin된 node만 기존 위치를 유지한다. Canvas를 불러오는 것만으로 기존
좌표를 재배치하지 않는다.

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

Review room은 `pr_review_rooms.canvas_id`로 `board_type=review` Canvas와 연결된다.
session graph row에는 Canvas shape ID나 geometry를 저장하지 않는다. 시스템 shape ID는
room file identity와 relation identity에서 계산하고 geometry는 `canvas_freeform_shapes`가
소유한다. graph 저장, 시스템 shape materialization, 분석 성공 처리와
`room.current_session_id` 교체는 하나의 DB transaction이다. materialization이 실패하면
전체 transaction을 rollback해 기존 current session과 Canvas를 유지한다.

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
    "decisionVersion": 0,
    "decisionCarriedOver": false,
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

새 head 분석에서 같은 room file의 `headBlobSha`가 이전 current session과 같고 원본 판단
이력이 있으면 상태, comment, 판단자와 판단 시각을 계승한다. 이때
`decisionCarriedOver=true`이며 새 `file_review_decisions` 행은 만들지 않는다. 사용자가 새
버전에서 판단을 저장하면 `decisionCarriedOver=false`로 바뀐다. SHA가 다르거나 `null`이면
`not_reviewed`로 시작한다.

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
- 서버는 PR의 전체 변경 파일을 Conflict로 간주하지 않는다. merge base, base branch,
  PR head branch 내용을 비교해 양쪽 변경이 실제로 충돌하는 파일만 `files` 또는
  `unsupportedFiles`에 포함한다. 일반적인 added/deleted/renamed 변경 파일은 제외한다.
- renamed 파일은 현재 경로와 `previousFilePath`를 함께 비교해 실제 rename/modify 충돌인지
  판정한다.
- `modify_delete`, `rename_modify`, `add_add`, `unsupported`는 후속 slice에서 처리하며,
  초기 구현에서는 `unsupportedFiles`에 안내용 metadata만 반환할 수 있다.
- conflict 분석 결과는 초기 read-only slice에서 DB에 저장하지 않는다.
- `review_files.current_status`, `file_review_decisions`, `review_submissions`를 변경하지 않는다.
- GitHub 원본 content 조회와 merge simulation은 PR Review 내부 dependency adapter를 통해
  수행하며, GitHub token은 응답과 로그에 노출하지 않는다.
- AI explanation, AI suggestion, Apply resolution, PR head branch commit, merge 실행은 이
  endpoint의 범위가 아니다.

## 공유 Conflict 해결 코드 초안

```http
GET /api/v1/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-draft
PATCH /api/v1/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-draft
```

`GET`은 아직 저장된 초안이 없으면 `data: null`을 반환한다. 클라이언트는 이 경우
현재 PR head 파일을 기준으로 Git conflict marker가 포함된 초기 편집 문서를 만든다.

`PATCH` body:

```json
{
  "sourceHeadBlobSha": "file_blob_sha",
  "resolvedContent": "<<<<<<< PR branch\nconst fromPr = true;\n=======\nconst fromTarget = true;\n>>>>>>> target branch",
  "expectedDraftVersion": 3
}
```

응답 `data`:

```json
{
  "reviewFileId": "review_file_1",
  "sourceHeadBlobSha": "file_blob_sha",
  "resolvedContent": "...",
  "draftVersion": 4,
  "updatedByUserId": "user_1",
  "updatedAt": "2026-07-15T01:00:00.000Z"
}
```

규칙:

- 초안은 review file 단위로 저장되며, 현재 PR Review room이 완료되었거나 PR이 닫히면 수정할 수 없다.
- `expectedDraftVersion`이 현재 저장 버전과 다르면 `409 Conflict`를 반환한다. 저장된 코드를 다시 불러온 뒤 이어서 편집해야 한다.
- 초안 저장 중에는 Git marker를 허용한다. 그러나 GitHub 적용 endpoint는 marker가 하나라도 남아 있으면 거절한다.
- App Server가 저장 성공 후 `pr-review:conflict-draft:updated` Realtime event를 같은 review Canvas room에 전달한다. 잠금/해제는 Realtime의 일시 상태이고, 코드 원본은 이 API와 DB다.

### `resolutionState`

Conflict 초안의 `resolvedContent`만으로는 hunk 선택 결과와 전체 코드 직접 편집을 구분할 수 없다. `GET`, `PATCH` 응답과 `pr-review:conflict-draft:updated` Realtime event는 아래 상태를 함께 제공한다. `PATCH` 요청도 같은 값을 포함해야 한다.

```json
{
  "resolutionState": {
    "resolutionChoices": { "hunk_1": "pr", "hunk_2": "ai" },
    "acceptedAiResolvedTexts": { "hunk_2": "const timeout = 45;" },
    "manualResolvedTexts": {},
    "suggestion": {
      "status": "suggested",
      "aiSummary": "두 변경이 같은 설정 값을 다르게 갱신합니다.",
      "aiSuggestion": "기존 동작을 유지하면서 timeout 값을 통합합니다.",
      "resolvedHunks": [
        { "hunkId": "hunk_2", "resolvedText": "const timeout = 45;" }
      ],
      "validationMessages": []
    },
    "isCustomized": false
  }
}
```

- `resolutionChoices` 값은 `ai`, `pr`, `target`, `both`, `manual` 중 하나다.
- `suggestion`은 AI 생성 결과 중 협업 화면에 필요한 요약, 제안, hunk별 해결 코드만 보관한다. 전체 `resolvedContent`는 중복 저장하지 않는다.
- AI 생성 endpoint 자체는 DB를 바꾸지 않는다. 사용자가 생성한 초안을 현재 Conflict draft에 반영하면 `suggestion`이 저장되고 같은 review Canvas room에 Realtime으로 공유된다.
- `isCustomized`가 `true`여도 hunk 선택을 막지 않는다. 새 선택 결과가 직접 수정과 겹치지 않으면 자동으로 함께 반영하고, 겹치면 사용자가 직접 수정 유지 또는 선택 결과 적용을 결정한다.
- migration 전 저장된 초안 또는 상태를 보내지 않는 이전 클라이언트의 저장은 기존 코드 보호를 위해 `isCustomized: true`로 처리한다.
- 전체 Conflict 적용이 비활성화된 경우 클라이언트는 준비된 파일 수와 사유를 버튼 근처에 표시한다.

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
- `currentDraft.resolvedContent`에는 아직 선택하지 않은 hunk의 conflict marker가 포함될 수 있다.
  AI는 이를 현재 해결 상태를 읽기 위한 문맥으로만 사용하고 marker를 결과에 복사하지 않는다.
  각 `currentDraft.hunks[].resolvedText`와 AI가 반환하는 `resolvedHunks[].resolvedText`는 conflict marker를
  포함할 수 없으며 파일 적용 크기 제한을 넘을 수 없다. hunk 전체 삭제를 나타내는 빈 `resolvedText`는 허용한다.
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
- suggestion endpoint 응답은 직접 DB에 저장하지 않는다. 클라이언트가 현재 Conflict draft에 반영한 협업용 suggestion은 `resolutionState.suggestion`으로 저장한다.
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
- Activity Log append transaction의 최종 실패는 위 local state sync 실패와 구분한다. GitHub
  branch 갱신이 이미 성공했더라도 이를 `sync_required`로 숨기지 않고 API error로 응답한다.
  GitHub에 conflict apply commit이 남아 있을 수 있으며 응답 전에 확보한 `commitSha`를 복구와
  dedupe 식별자로 사용한다.
- GitHub branch 갱신 전에 head/base SHA가 바뀌거나 fast-forward가 거절되면
  `409 Conflict`를 반환한다.
- `review_files.current_status`, `file_review_decisions`, `review_submissions`를 변경하지 않는다.
- GitHub merge API 호출, PR close, review submission은 이 endpoint의 범위가 아니다.

## 파일별 Review Decision 저장

```json
{
  "status": "discussion_needed",
  "comment": "Need to confirm empty state behavior.",
  "expectedDecisionVersion": 0
}
```

서버는 `expectedDecisionVersion`이 현재 `review_files.decision_version`과 일치할 때만
`review_files.current_status/comment`를 갱신하고 `decision_version`을 1 증가시킨 뒤
`file_review_decisions` row를 추가한다. 현재 저장된 status/comment와 요청 내용이 완전히
같으면 버전이 달라도 이미 반영된 요청으로 간주하고 새 history row를 만들지 않는다.

PATCH response는 Review File 상세 조회와 같은 payload를 반환한다.

다른 판단이 먼저 저장되어 버전이 달라졌다면 기존 판단을 덮어쓰지 않고 `409 Conflict`를
반환한다.

```json
{
  "success": false,
  "error": {
    "code": "REVIEW_DECISION_CHANGED",
    "message": "Another reviewer saved a decision first",
    "latestDecision": {
      "decisionVersion": 1,
      "currentStatus": "approved",
      "comment": "문제 없음",
      "reviewedByUserId": "user_2",
      "reviewedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

클라이언트는 이 응답을 받으면 최신 Review File을 다시 조회한다. 최신 저장값은 화면에
반영하되 사용자가 작성 중이던 status/comment 초안은 유지하고, 다른 리뷰어의 판단을
불러왔다는 짧은 안내를 표시한다.

저장이 실제 변경을 만든 경우 App Server는 DB commit이 끝난 뒤 Redis channel
`pr-review:decision-events`로 다음 이벤트를 best-effort 발행한다. Redis 발행 실패는 이미
완료된 decision 저장을 실패로 바꾸지 않는다. Realtime Server는 payload를 검증한 뒤 해당
Canvas room에 `pr-review:decision:updated` 이벤트를 전달한다.

```json
{
  "event": "pr-review:decision:updated",
  "workspaceId": "workspace_1",
  "canvasId": "canvas_1",
  "reviewRoomId": "review_room_1",
  "reviewSessionId": "review_session_1",
  "reviewFileId": "review_file_1",
  "roomFileId": "room_file_1",
  "currentStatus": "approved",
  "decisionVersion": 1,
  "reviewedCount": 1,
  "totalFileCount": 3,
  "readyToSubmit": false,
  "reviewedByUserId": "user_1",
  "reviewedAt": "2026-01-01T00:00:00.000Z"
}
```

클라이언트는 이벤트의 session/file 식별자가 현재 화면과 일치할 때 진행률과 파일 노드
배지를 즉시 갱신한다. 열어 둔 파일이 갱신되었으면 최신 파일 정보를 다시 조회하되 작성 중인
초안은 유지한다. Socket 재접속 시에는 summary와 Canvas API를 다시 조회해 유실된 이벤트를
복구한다.

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
- GitHub merge 성공 뒤 local room completion/Activity Log transaction이 실패하면 실패를 숨기지
  않고 API error로 응답한다. 이때 GitHub PR은 이미 merged 상태일 수 있으며, GitHub 응답에서
  확보한 `mergeCommitSha`를 복구와 Activity Log dedupe 식별자로 사용한다.
- review session status는 별도 `merged` 상태로 바꾸지 않고 기존 `submitted` 상태를 유지한다.
- GitHub token, raw provider error, secret은 API 응답이나 로그에 노출하지 않는다.

## Agent 핵심 파일 추천

PR Review Canvas에서도 기존 우측 하단 Agent 버튼과 side panel을 사용할 수 있다. PR Review URL의
`reviewSessionId`가 유효한 UUID이면 Frontend는 Agent run에 아래 context를 보낸다.

```json
{
  "surface": "pr_review",
  "sessionId": "review_session_uuid"
}
```

이는 화면 힌트이며 서버는 현재 Workspace 접근 권한과 review session의 room Workspace 소속을 재검증한다.
해당 context에서는 `recommend_pr_review_focus`가 현재 revision의 핵심 검토 파일을 최대 3개, 연결 확인
파일을 최대 2개까지 추천할 수 있다. 결과에는 파일 경로, 위험도, 역할, 변경 요약, 검토 포인트, 결정 상태,
파일 관계만 포함한다. raw diff, 코드 원문, 사용자 comment는 Agent로 전달하거나 Agent 실행 이력에 저장하지
않는다. `analyzing` 또는 `failed` session은 추천 대신 완료 또는 재시도 안내를 반환한다.

## MVP 제외

- GitHub inline review comment
- PR close without merge
- PR head branch delete after merge
- MVP에서 AI 생성 flow graph 편집
