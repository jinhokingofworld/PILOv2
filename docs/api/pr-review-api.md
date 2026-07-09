# PR Review API

## 범위

PR Review API는 다음 기능을 담당한다.

- Review session 생성, 조회, 상태 수정, 삭제
- AI가 생성한 PR 목적, 변경 요약, 주의점, flow, file review order 저장과 조회
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
| 사용자 GitHub OAuth 연결 상태 | GitHub Integration |
| Review session, flow, file decision, submission | PR Review |

## 데이터 규칙

- Review session은 PR 리뷰 화면에 머무는 동안 사용하는 MVP 임시 작업 데이터다.
- 사용자가 PR 리뷰 화면을 나가면 review session 삭제 API를 호출한다.
- 세션 삭제 시 flow, file, file decision, submission history는 FK cascade로 함께 삭제된다.
- `review_submissions`는 화면 안에서 제출 결과와 실패 원인을 확인하기 위한 세션 내부 이력이다.
- `review_files`는 file metadata와 review state를 저장한다.
- Diff 응답은 GitHub Integration을 통해 PR 변경 파일과 patch 정보를 조회해 만든다.
- PR 리뷰 canvas는 `review_flows`, `review_files`, `review_flow_files`에서 생성하는 view model이다. 자유형 `canvas` 테이블에 저장하지 않는다.
- `review_flow_files`는 같은 review session에 속한 `review_flows`와 `review_files`만 연결한다.
- GitHub Review 제출은 GitHub Integration에서 연결한 현재 사용자의 GitHub App user OAuth token으로 수행하며 review body만 제출한다.
- 현재 GitHub PR head SHA가 session의 `headSha`와 다르면 제출을 막는다.

## 상태값

| Field | Values |
| --- | --- |
| `prReviewSession.status` | `analyzing`, `reviewing`, `ready_to_submit`, `submitted`, `failed`, `archived` |
| `reviewFile.currentStatus` | `not_reviewed`, `approved`, `discussion_needed`, `unknown` |
| `reviewFile.riskLevel` | `high`, `medium`, `low`, `unknown` |
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
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 상세 조회 |
| `PATCH` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 상태 수정 |
| `DELETE` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` | Review session 삭제 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/summary` | PR 요약 패널 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/result` | 전체 리뷰 결과 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/canvas` | 리뷰 canvas view model 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/conflicts` | Post-MVP read-only conflict 분석 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-suggestion` | Post-MVP AI conflict 해결 초안 생성 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/flows` | Flow 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-flows/{flowId}/files` | Flow에 속한 file 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}` | Review file 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/diff` | File diff view model 조회 |
| `PATCH` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/review` | 파일별 review decision 저장 |
| `GET` | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/decisions` | 파일별 decision history 조회 |
| `POST` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` | GitHub Review 제출 |
| `GET` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` | 제출 이력 조회 |
| `GET` | `/workspaces/{workspaceId}/github/review-submissions/{submissionId}` | 제출 상세 조회 |

## Review Session 생성

```json
{}
```

응답 주요 필드:

```json
{
  "id": "review_session_uuid",
  "pullRequestId": "pull_request_uuid",
  "headSha": "abc123",
  "status": "reviewing",
  "prPurpose": "Why this PR exists",
  "changeSummary": ["Summary item"],
  "recommendedReviewOrder": "Review shared structure first",
  "cautionPoints": ["Check auth edge cases"],
  "reviewedCount": 0,
  "totalFileCount": 5,
  "conflictStatus": "clean",
  "createdByUserId": "user_uuid"
}
```

서버 규칙:

- GitHub Integration API로 PR 상세, 변경 파일, conflict 상태를 조회한다.
- 생성 시점의 `headSha`를 저장한다.
- 파일 metadata는 `review_files`에 저장한다.
- App Server는 PR 상세와 변경 파일 정보를 입력으로 AI 분석을 생성한다.
- `OPENAI_API_KEY`가 있으면 OpenAI Responses API structured output을 사용하고, key 누락/API 실패/응답 검증 실패 시 deterministic fallback 결과를 저장한다.
- Diff 생성에 필요한 patch 정보는 GitHub Integration API의 PR 변경 파일 응답을 기준으로 사용한다.
- 같은 PR을 다시 리뷰하더라도 새 Review Session을 생성한다.
- 중복 클릭 방지는 프론트 버튼 disabled와 서버의 진행 중 생성 요청 방어 로직으로 처리한다.

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

- `review_flows`, `review_files`, `review_flow_files`는 session 삭제와 함께 삭제된다.
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
            "riskLevel": "medium",
            "reviewStatus": "not_reviewed"
          }
        }
      ]
    }
  ],
  "edges": [
    {
      "fromReviewFileId": "review_file_uuid_1",
      "toReviewFileId": "review_file_uuid_2",
      "flowId": "flow_uuid",
      "reason": "리뷰 순서"
    }
  ]
}
```

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
이 endpoint는 conflict 파일 하나에 대해 transient 해결 초안을 반환하며, DB에 저장하거나
PR head branch를 수정하지 않는다.

```http
POST /api/v1/workspaces/{workspaceId}/github/review-files/{reviewFileId}/conflict-suggestion
```

요청 body:

```json
{}
```

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
    "aiSummary": "같은 title 상수를 base branch와 head branch가 서로 다른 문구로 수정해 충돌했습니다.",
    "aiSuggestion": "두 문구의 의미를 합쳐 화면 맥락이 드러나는 이름으로 정리하는 초안입니다.",
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
- `resolvedContent`가 비어 있거나 `<<<<<<<`, `=======`, `>>>>>>>` conflict marker를 포함하면
  `status: "invalid"`와 `validationMessages`를 반환한다.
- suggestion 결과는 DB에 저장하지 않는다.
- `review_files.current_status`, `file_review_decisions`, `review_submissions`를 변경하지 않는다.
- GitHub branch commit, GitHub merge API 호출, Apply resolution은 이 endpoint의 범위가 아니다.

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

## MVP 제외

- GitHub inline review comment
- PR merge/close
- MVP에서 AI 생성 flow graph 편집
