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
- GitHub Review 제출은 현재 사용자의 OAuth token으로 수행하며 review body만 제출한다.
- 현재 GitHub PR head SHA가 session의 `headSha`와 다르면 제출을 막는다.

## 상태값

| Field | Values |
| --- | --- |
| `prReviewSession.status` | `analyzing`, `reviewing`, `ready_to_submit`, `submitted`, `failed`, `archived` |
| `reviewFile.currentStatus` | `not_reviewed`, `approved`, `discussion_needed`, `unknown` |
| `fileReviewDecision.status` | `approved`, `discussion_needed`, `unknown` |
| `reviewSubmission.submitType` | `COMMENT`, `APPROVE`, `REQUEST_CHANGES` |
| `reviewSubmission.githubSubmitStatus` | `not_submitted`, `submitting`, `submitted`, `failed` |
| `conflictStatus` | `checking`, `clean`, `conflicted`, `unknown` |
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

## Review Canvas View Model

리뷰 canvas endpoint는 PR 리뷰 화면용 graph를 반환한다. 자유형 Canvas API와
분리된 view model이다.

```json
{
  "flows": [
    {
      "id": "flow_uuid",
      "title": "Entry flow",
      "description": "Review entry points first",
      "sortOrder": 1,
      "files": [
        {
          "reviewFileId": "review_file_uuid",
          "filePath": "apps/frontend/page.tsx",
          "workflowOrder": 1,
          "currentStatus": "not_reviewed"
        }
      ]
    }
  ],
  "edges": [
    {
      "fromReviewFileId": "review_file_uuid_1",
      "toReviewFileId": "review_file_uuid_2",
      "reason": "Shared state flow"
    }
  ]
}
```

PR Review schema에는 `canvas_id`, `canvas_shape_id`,
`canvas_freeform_shapes` 관계가 없다.

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

## 파일별 Review Decision 저장

```json
{
  "status": "discussion_needed",
  "comment": "Need to confirm empty state behavior."
}
```

서버는 `review_files.current_status/comment`를 갱신하고
`file_review_decisions` row를 추가한다.

## GitHub Review 제출

```json
{
  "submitType": "COMMENT",
  "reviewBody": "## PILO PR Review\n\nSummary..."
}
```

서버 규칙:

- 사용자의 GitHub OAuth 연결 여부를 확인한다.
- 현재 PR head SHA를 다시 조회해 session `headSha`와 비교한다.
- GitHub Review body만 제출한다.
- Line comment payload는 보내지 않는다.
- 제출 시도는 `review_submissions`에 저장한다.
- 화면 이탈로 session이 삭제되면 해당 local submission history도 함께 삭제된다.

## MVP 제외

- GitHub inline review comment
- PR merge/close
- MVP에서 AI 생성 flow graph 편집
