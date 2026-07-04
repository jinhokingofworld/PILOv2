# PR Review API Spec

작성일: 2026-07-03

## 1. 문서 범위

이 문서는 PILO의 PR 리뷰 기능 API를 정의한다.

이 문서가 소유하는 범위는 다음과 같다.

- PR 리뷰 세션 생성/조회/상태 변경/삭제
- AI 분석 결과 저장 및 조회
- 리뷰 Flow, 리뷰 파일, Flow-파일 연결
- Canvas file_node 응답 데이터
- 파일별 리뷰 판단 및 PILO 내부 comment
- side-by-side diff view model
- GitHub Review 제출 및 제출 이력 저장

이 문서가 소유하지 않는 범위는 다음과 같다.

- GitHub App installation
- Repository/ProjectV2/Issue/PR 원본 동기화
- PR 목록/상세/변경 파일 원본 조회
- PR conflict 원본 조회
- 사용자 GitHub OAuth 연결

위 제외 범위는 [GITHUB_INTEGRATION_API_SPEC.md](./GITHUB_INTEGRATION_API_SPEC.md)에서 정의한다.

## 2. 연동 경계

PR 리뷰 기능은 GitHub 연동 기능과 다음 경계로 분리한다.

| 기능                                 | 담당 API 문서          | 설명                                                                                 |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------ |
| Open PR 목록 조회                    | GitHub Integration API | `GET /workspaces/{workspaceId}/github/repositories/{repositoryId}/pull-requests`     |
| PR 상세 조회                         | GitHub Integration API | `GET /workspaces/{workspaceId}/github/pull-requests/{pullRequestId}`                 |
| PR 변경 파일 조회                    | GitHub Integration API | `GET /workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/files`           |
| PR conflict 조회                     | GitHub Integration API | `GET /workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/conflict-status` |
| 사용자 GitHub OAuth 상태 조회        | GitHub Integration API | `GET /me/github`                                                                     |
| 리뷰 세션/분석/캔버스/파일 리뷰/제출 | PR Review API          | 이 문서에서 정의                                                                     |

## 3. 인증 구조

GitHub 연동은 하이브리드 구조를 사용한다.

- Repository/PR 읽기: GitHub App installation token 사용
- GitHub Review 제출: 로그인한 PILO 사용자의 OAuth token 사용

GitHub Review 제출 전 서버는 `users.github_access_token_encrypted`가 존재하고 유효한지 확인한다. 연결되어 있지 않으면 `GITHUB_USER_NOT_CONNECTED`를 반환한다.

## 4. 공통 규칙

### Base URL

```text
/api/v1
```

### 응답 포맷

이 문서는 GitHub Integration API와 동일하게 `success`, `data`, `meta` 응답 포맷을 사용한다.

```json
{
  "success": true,
  "data": {}
}
```

목록 응답은 `meta`를 포함한다.

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### 주요 정책

- Open PR만 리뷰 대상으로 사용한다.
- `changedFilesCount`는 GitHub PR 변경 파일 수이며, 리뷰 세션의 `totalFileCount`도 같은 값을 사용한다.
- 리뷰 세션은 MVP 기준 임시 데이터다. 사용자가 리뷰 화면을 나가면 세션과 관련 리뷰 데이터는 삭제된다.
- GitHub line comment는 지원하지 않는다.
- 파일별 `comment`는 PILO 내부 리뷰 메모이며 GitHub Review 제출 시 `reviewBody`에 포함한다.
- Merge 기능은 구현하지 않는다. conflict 여부는 표시만 한다.
- 제출 전 현재 GitHub PR head SHA가 리뷰 세션의 `headSha`와 다르면 제출을 막는다.

## 5. 상태값

| 필드                                  | 값                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `prReviewSession.status`              | `analyzing`, `reviewing`, `ready_to_submit`, `submitted`, `failed`, `archived` |
| `reviewFile.currentStatus`            | `not_reviewed`, `approved`, `discussion_needed`, `unknown`                     |
| `fileReviewDecision.status`           | `approved`, `discussion_needed`, `unknown`                                     |
| `reviewSubmission.submitType`         | `COMMENT`, `APPROVE`, `REQUEST_CHANGES`                                        |
| `reviewSubmission.githubSubmitStatus` | `not_submitted`, `submitting`, `submitted`, `failed`                           |
| `conflictStatus`                      | `checking`, `clean`, `conflicted`, `unknown`                                   |
| `diff.mode`                           | `side_by_side`, `binary`, `large`                                              |

## 6. API 목록

| Method   | Endpoint                                                                         | 설명                     |
| -------- | -------------------------------------------------------------------------------- | ------------------------ |
| `POST`   | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-sessions` | 리뷰 세션 생성           |
| `GET`    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`             | 리뷰 세션 상세 조회      |
| `PATCH`  | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`             | 리뷰 세션 상태 수정      |
| `DELETE` | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}`             | 리뷰 세션 삭제           |
| `GET`    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/summary`     | PR 요약 창 조회          |
| `GET`    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/result`      | 전체 리뷰 결과 조회      |
| `GET`    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/canvas`      | 리뷰 캔버스 조회         |
| `GET`    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/flows`       | Flow 목록 조회           |
| `GET`    | `/workspaces/{workspaceId}/github/review-flows/{flowId}/files`                   | Flow 파일 노드 목록 조회 |
| `GET`    | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}`                   | 파일 리뷰 상세 조회      |
| `GET`    | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/diff`              | 파일 diff 조회           |
| `PATCH`  | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/review`            | 파일 리뷰 판단 저장      |
| `GET`    | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/decisions`         | 파일 리뷰 판단 이력 조회 |
| `POST`   | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` | GitHub 리뷰 제출         |
| `GET`    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` | 리뷰 제출 이력 조회      |
| `GET`    | `/workspaces/{workspaceId}/github/review-submissions/{submissionId}`             | 리뷰 제출 상세 조회      |

## 7. 리뷰 세션 생성

| 항목        | 내용                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Method      | `POST`                                                                                                        |
| Endpoint    | `/workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-sessions`                              |
| 주요 테이블 | `pr_review_sessions`, `review_flows`, `review_files`, `review_flow_files`, `canvas`, `canvas_freeform_shapes` |

리뷰 시작 버튼을 눌렀을 때 호출한다. 서버는 GitHub Integration API가 제공하는 PR 상세/변경 파일/conflict 정보를 기반으로 리뷰 세션, 리뷰 Flow, 리뷰 파일, Flow-파일 연결, 캔버스 file_node를 생성한다.

### Request Body

```json
{
  "forceRegenerate": false
}
```

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "review_session_1",
    "pullRequestId": "pr_1",
    "canvasId": "canvas_123",
    "headSha": "abc123",
    "status": "reviewing",
    "prPurpose": "음성 회의 페이지와 회의 종료 후 리포트 UI 흐름 추가",
    "changeSummary": ["음성 회의 페이지 추가", "리포트 게시판 화면 추가"],
    "recommendedReviewOrder": "공통 진입 구조를 먼저 확인한 뒤 각 페이지 UI를 확인",
    "cautionPoints": ["사이드바 탭과 라우팅 경로 일치 여부 확인"],
    "reviewedCount": 0,
    "totalFileCount": 5,
    "conflictStatus": "clean",
    "conflictCheckedAt": "2026-07-02T13:12:00.000Z",
    "createdByUserId": "user_1",
    "createdAt": "2026-07-02T13:15:00.000Z"
  }
}
```

### 저장 규칙

- `headSha`는 리뷰 시작 시점의 PR head SHA를 저장한다.
- `totalFileCount`는 GitHub PR의 `changedFilesCount`와 같은 값으로 저장한다.
- conflict 상태는 GitHub Integration API의 conflict 조회 결과를 snapshot으로 저장한다.
- 세션 생성 후 AI 분석이 비동기로 진행되는 경우 최초 `status`는 `analyzing`일 수 있다.

## 8. 리뷰 세션 상세 조회

| 항목     | 내용                                                                 |
| -------- | -------------------------------------------------------------------- |
| Method   | `GET`                                                                |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` |

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "review_session_1",
    "pullRequest": {
      "id": "pr_1",
      "githubNumber": 24,
      "title": "음성회의 및 리포트 페이지 목업 구현",
      "authorName": "jinhokingofworld",
      "headBranch": "feature/voice-report",
      "baseBranch": "main",
      "headSha": "abc123"
    },
    "canvasId": "canvas_123",
    "headSha": "abc123",
    "status": "reviewing",
    "prPurpose": "음성 회의 페이지와 회의 종료 후 리포트 UI 흐름 추가",
    "changeSummary": ["음성 회의 페이지 추가", "리포트 게시판 화면 추가"],
    "recommendedReviewOrder": "공통 진입 구조를 먼저 확인한 뒤 각 페이지 UI를 확인",
    "cautionPoints": ["사이드바 탭과 라우팅 경로 일치 여부 확인"],
    "reviewedCount": 2,
    "totalFileCount": 5,
    "conflictStatus": "clean"
  }
}
```

## 9. 리뷰 세션 상태 수정

| 항목     | 내용                                                                 |
| -------- | -------------------------------------------------------------------- |
| Method   | `PATCH`                                                              |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` |

### Request Body

```json
{
  "status": "ready_to_submit"
}
```

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "review_session_1",
    "status": "ready_to_submit",
    "updatedAt": "2026-07-02T13:20:00.000Z"
  }
}
```

## 10. 리뷰 세션 삭제

| 항목     | 내용                                                                 |
| -------- | -------------------------------------------------------------------- |
| Method   | `DELETE`                                                             |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}` |

사용자가 PR 리뷰 화면을 나갈 때 호출한다. MVP에서는 세션을 유지하지 않고 삭제한다.

### Response Body

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

### 삭제 규칙

- `review_flows`, `review_files`, `review_flow_files`, `file_review_decisions`, `review_submissions`는 DB FK cascade로 삭제된다.
- `canvas`는 `pr_review_sessions.canvas_id` FK가 `ON DELETE SET NULL`이므로 세션 삭제만으로 자동 삭제되지 않는다.
- 서버 서비스 로직에서 해당 `canvasId`의 `canvas`를 명시 삭제해야 한다.
- `canvas_freeform_shapes`는 canvas 삭제에 의해 함께 삭제된다.

## 11. PR 요약 창 조회

| 항목     | 내용                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| Method   | `GET`                                                                        |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/summary` |

### Response Body

```json
{
  "success": true,
  "data": {
    "githubNumber": 24,
    "title": "음성회의 및 리포트 페이지 목업 구현",
    "authorName": "jinhokingofworld",
    "relativeTime": "opened 19 hours ago",
    "headBranch": "feature/voice-report",
    "baseBranch": "main",
    "changedFilesCount": 5,
    "additions": 128,
    "deletions": 32,
    "commitsCount": 3,
    "prPurpose": "음성 회의 페이지와 회의 종료 후 리포트 UI 흐름 추가",
    "changeSummary": ["음성 회의 페이지 추가", "리포트 게시판 화면 추가"],
    "recommendedReviewOrder": "공통 진입 구조를 먼저 확인한 뒤 각 페이지 UI를 확인",
    "cautionPoints": ["사이드바 탭과 라우팅 경로 일치 여부 확인"],
    "conflictStatus": "clean"
  }
}
```

## 12. 전체 리뷰 결과 조회

| 항목     | 내용                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Method   | `GET`                                                                       |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/result` |

### Response Body

```json
{
  "success": true,
  "data": {
    "reviewResultSummary": "문제 없음 3개 / 논의·수정 필요 1개 / 판단 불가 1개",
    "fileReviewResults": [
      {
        "reviewFileId": "review_file_1",
        "fileName": "VoiceMeetingPage.tsx",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "status": "approved",
        "comment": "문제 없음"
      }
    ],
    "readyToSubmit": true
  }
}
```

## 13. 리뷰 캔버스 조회

| 항목     | 내용                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Method   | `GET`                                                                       |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/canvas` |

한 파일은 여러 Flow에 포함될 수 있다. 파일의 실제 리뷰 상태와 comment는 `reviewFile` 기준으로 공유되며, Flow 내부 순서와 캔버스 노드 연결은 `flowFile` 기준으로 관리한다.

`canvasShapeId`는 `canvas_freeform_shapes.id`를 가리키는 TEXT 값이다.

### Response Body

```json
{
  "success": true,
  "data": {
    "sessionId": "review_session_1",
    "canvasId": "canvas_123",
    "headBranch": "feature/voice-report",
    "baseBranch": "main",
    "reviewedCount": 2,
    "totalFileCount": 5,
    "conflictStatus": "clean",
    "flows": [
      {
        "id": "flow_1",
        "title": "공통 네비게이션",
        "description": "사이드바와 라우팅 흐름",
        "sortOrder": 1
      }
    ],
    "flowFiles": [
      {
        "id": "review_flow_file_1",
        "flowId": "flow_1",
        "reviewFileId": "review_file_1",
        "canvasShapeId": "file-node-shape-1",
        "workflowOrder": 1,
        "fileNodeData": {
          "reviewFileId": "review_file_1",
          "reviewSessionId": "review_session_1",
          "reviewFlowFileId": "review_flow_file_1",
          "flowId": "flow_1",
          "workflowOrder": 1,
          "fileName": "VoiceMeetingPage.tsx",
          "roleSummary": "음성 회의 화면",
          "reviewStatus": "not_reviewed"
        }
      }
    ]
  }
}
```

### fileNodeData

Canvas 담당자는 `file_node` custom node type을 예약한다. PR 리뷰 기능이 요구하는 최소 data는 아래와 같다.

```ts
type FileNodeData = {
  reviewFileId: string;
  reviewSessionId: string;
  reviewFlowFileId: string;
  flowId: string;
  workflowOrder: number;
  fileName: string;
  roleSummary: string;
  reviewStatus: "not_reviewed" | "approved" | "discussion_needed" | "unknown";
};
```

## 14. Flow 목록 조회

| 항목     | 내용                                                                       |
| -------- | -------------------------------------------------------------------------- |
| Method   | `GET`                                                                      |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/flows` |

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "flow_1",
      "sessionId": "review_session_1",
      "title": "공통 네비게이션",
      "description": "사이드바와 라우팅 흐름",
      "sortOrder": 1
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

## 15. Flow 파일 노드 목록 조회

| 항목     | 내용                                                           |
| -------- | -------------------------------------------------------------- |
| Method   | `GET`                                                          |
| Endpoint | `/workspaces/{workspaceId}/github/review-flows/{flowId}/files` |

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "review_flow_file_1",
      "flowId": "flow_1",
      "reviewFileId": "review_file_1",
      "canvasShapeId": "file-node-shape-1",
      "workflowOrder": 1,
      "fileNodeData": {
        "reviewFileId": "review_file_1",
        "reviewSessionId": "review_session_1",
        "reviewFlowFileId": "review_flow_file_1",
        "flowId": "flow_1",
        "workflowOrder": 1,
        "fileName": "VoiceMeetingPage.tsx",
        "roleSummary": "음성 회의 화면",
        "reviewStatus": "not_reviewed"
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

## 16. 파일 리뷰 상세 조회

| 항목     | 내용                                                           |
| -------- | -------------------------------------------------------------- |
| Method   | `GET`                                                          |
| Endpoint | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}` |

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "review_file_1",
    "sessionId": "review_session_1",
    "filePath": "apps/frontend/VoiceMeetingPage.tsx",
    "previousFilePath": null,
    "fileName": "VoiceMeetingPage.tsx",
    "fileStatus": "modified",
    "additions": 84,
    "deletions": 12,
    "isBinary": false,
    "isLargeDiff": false,
    "githubFileUrl": "https://github.com/my-team/pilo/pull/24/files#diff-abc",
    "fileRole": "음성 회의 화면",
    "changeReason": "음성 회의 페이지를 추가하기 위해 변경됨",
    "changeSummary": "회의 화면 레이아웃과 상태 표시 UI 추가",
    "reviewPoints": [
      "회의 상태가 명확한가?",
      "종료 후 리포트 이동 흐름이 자연스러운가?"
    ],
    "currentStatus": "not_reviewed",
    "comment": null,
    "flowMemberships": [
      {
        "reviewFlowFileId": "review_flow_file_1",
        "flowId": "flow_1",
        "flowTitle": "공통 네비게이션",
        "workflowOrder": 1,
        "canvasShapeId": "file-node-shape-1"
      }
    ],
    "latestDecision": null
  }
}
```

## 17. 파일 diff 조회

| 항목     | 내용                                                                |
| -------- | ------------------------------------------------------------------- |
| Method   | `GET`                                                               |
| Endpoint | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/diff` |

기본 diff는 side-by-side로 반환한다. Binary 파일 또는 큰 diff는 본문 diff를 내려주지 않고 안내 메시지와 GitHub 파일 URL을 반환한다.

큰 diff 기준은 아래 중 하나다.

- `additions + deletions >= 1000`
- `patchSizeBytes >= 200KB`
- GitHub patch가 누락된 경우

### Response Body - side-by-side

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

### Response Body - binary 또는 large diff

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

## 18. 파일 리뷰 판단 저장

| 항목        | 내용                                                                  |
| ----------- | --------------------------------------------------------------------- |
| Method      | `PATCH`                                                               |
| Endpoint    | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/review` |
| 주요 테이블 | `review_files`, `file_review_decisions`                               |

파일별 PILO 내부 리뷰 상태와 comment를 저장한다. 서버는 `review_files.current_status/comment`를 갱신하고 `file_review_decisions`에 이력을 추가한다.

### Request Body

```json
{
  "status": "discussion_needed",
  "comment": "종료 버튼 상태 확인 필요"
}
```

### Response Body

```json
{
  "success": true,
  "data": {
    "decisionId": "decision_1",
    "reviewFileId": "review_file_1",
    "currentStatus": "discussion_needed",
    "comment": "종료 버튼 상태 확인 필요",
    "reviewedByUserId": "user_1",
    "reviewedAt": "2026-07-02T13:30:00.000Z",
    "reviewedCount": 3,
    "totalFileCount": 5
  }
}
```

## 19. 파일 리뷰 판단 이력 조회

| 항목     | 내용                                                                     |
| -------- | ------------------------------------------------------------------------ |
| Method   | `GET`                                                                    |
| Endpoint | `/workspaces/{workspaceId}/github/review-files/{reviewFileId}/decisions` |

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "decision_1",
      "reviewFileId": "review_file_1",
      "status": "discussion_needed",
      "comment": "종료 버튼 상태 확인 필요",
      "reviewedByUserId": "user_1",
      "reviewedAt": "2026-07-02T13:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

## 20. GitHub 리뷰 제출

| 항목        | 내용                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| Method      | `POST`                                                                           |
| Endpoint    | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` |
| 주요 테이블 | `review_submissions`, `pr_review_sessions`, `users`                              |

제출 모달에서 사용자가 `submitType`을 직접 선택한다. 제출 모달은 서버가 내려준 리뷰 결과를 기반으로 기본 `reviewBody`를 생성하거나 클라이언트 템플릿으로 생성한다. 사용자는 `reviewBody`를 직접 수정할 수 있고, 서버는 전달받은 `reviewBody`를 그대로 GitHub에 제출한다.

GitHub line comment는 지원하지 않으며 comments 배열을 받지 않는다.

### 제출 전 검증

- 사용자 GitHub OAuth 연결 여부 확인
- 현재 GitHub PR head SHA와 세션의 `headSha` 일치 여부 확인
- `submitType` 값 검증
- `reviewBody` 비어 있음 여부 검증

### Request Body

```json
{
  "submitType": "REQUEST_CHANGES",
  "reviewBody": "## PILO PR Review\n\n### 요약\n- 목적: 음성 회의 페이지와 회의 종료 후 리포트 UI 흐름 추가\n- 결과: 논의·수정 필요\n\n### 파일별 리뷰\n- [문제 없음] VoiceMeetingPage.tsx: 문제 없음\n- [논의/수정 필요] ReportPage.tsx: 종료 버튼 상태 확인 필요\n- [판단 불가] legacy.ts: 변경 의도를 코드만으로 판단하기 어려움"
}
```

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "submission_1",
    "sessionId": "review_session_1",
    "submitType": "REQUEST_CHANGES",
    "reviewBody": "## PILO PR Review...",
    "reviewResultSummary": "문제 없음 3개 / 논의·수정 필요 1개 / 판단 불가 1개",
    "fileReviewResults": [
      {
        "fileName": "VoiceMeetingPage.tsx",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "status": "approved",
        "comment": "문제 없음"
      }
    ],
    "githubSubmitStatus": "submitted",
    "githubReviewId": "123456789",
    "githubReviewUrl": "https://github.com/my-team/pilo/pull/24#pullrequestreview-123456789",
    "submittedByUserId": "user_1",
    "submittedByGithubLogin": "jinhokingofworld",
    "submittedAt": "2026-07-02T13:40:00.000Z"
  }
}
```

## 21. 리뷰 제출 이력 조회

| 항목     | 내용                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| Method   | `GET`                                                                            |
| Endpoint | `/workspaces/{workspaceId}/github/review-sessions/{reviewSessionId}/submissions` |

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "submission_1",
      "sessionId": "review_session_1",
      "submitType": "REQUEST_CHANGES",
      "githubSubmitStatus": "submitted",
      "githubReviewId": "123456789",
      "githubReviewUrl": "https://github.com/my-team/pilo/pull/24#pullrequestreview-123456789",
      "submittedByUserId": "user_1",
      "submittedByGithubLogin": "jinhokingofworld",
      "submittedAt": "2026-07-02T13:40:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

## 22. 리뷰 제출 상세 조회

| 항목     | 내용                                                                 |
| -------- | -------------------------------------------------------------------- |
| Method   | `GET`                                                                |
| Endpoint | `/workspaces/{workspaceId}/github/review-submissions/{submissionId}` |

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "submission_1",
    "sessionId": "review_session_1",
    "submitType": "REQUEST_CHANGES",
    "reviewBody": "## PILO PR Review...",
    "reviewResultSummary": "문제 없음 3개 / 논의·수정 필요 1개 / 판단 불가 1개",
    "fileReviewResults": [
      {
        "fileName": "VoiceMeetingPage.tsx",
        "filePath": "apps/frontend/VoiceMeetingPage.tsx",
        "status": "approved",
        "comment": "문제 없음"
      }
    ],
    "githubSubmitStatus": "submitted",
    "githubReviewId": "123456789",
    "githubReviewUrl": "https://github.com/my-team/pilo/pull/24#pullrequestreview-123456789",
    "submittedByUserId": "user_1",
    "submittedByGithubLogin": "jinhokingofworld",
    "errorMessage": null,
    "submittedAt": "2026-07-02T13:40:00.000Z",
    "createdAt": "2026-07-02T13:39:58.000Z",
    "updatedAt": "2026-07-02T13:40:00.000Z"
  }
}
```

## 23. 오류 코드

| HTTP Status | Code                          | 설명                                                      |
| ----------- | ----------------------------- | --------------------------------------------------------- |
| 400         | `INVALID_REQUEST`             | 요청 값이 올바르지 않음                                   |
| 401         | `UNAUTHORIZED`                | 인증되지 않은 요청                                        |
| 403         | `FORBIDDEN`                   | workspace 접근 권한 없음                                  |
| 403         | `GITHUB_USER_NOT_CONNECTED`   | GitHub Review 제출용 사용자 OAuth 연결이 없음             |
| 404         | `NOT_FOUND`                   | 요청한 PR, 리뷰 세션, 리뷰 파일, 제출 이력을 찾을 수 없음 |
| 409         | `STALE_PR_HEAD`               | 리뷰 시작 이후 PR head commit이 변경됨                    |
| 422         | `GITHUB_REVIEW_SUBMIT_FAILED` | GitHub Review 제출 실패                                   |
| 500         | `INTERNAL_ERROR`              | 서버 내부 오류                                            |

### PR Head 변경 감지

```json
{
  "success": false,
  "error": {
    "code": "STALE_PR_HEAD",
    "message": "리뷰 시작 이후 PR head commit이 변경되었습니다. 리뷰를 다시 시작해주세요.",
    "sessionHeadSha": "abc123",
    "currentHeadSha": "xyz789"
  }
}
```

### 사용자 GitHub 미연결

```json
{
  "success": false,
  "error": {
    "code": "GITHUB_USER_NOT_CONNECTED",
    "message": "GitHub Review 제출을 위해 사용자 GitHub 계정을 먼저 연결해주세요."
  }
}
```
