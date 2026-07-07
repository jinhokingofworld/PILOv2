# Board API

## 범위

Board API는 GitHub Project Kanban 화면을 위한 로컬 캐시 API와 제한된
issue write API를 제공한다.

- `boards`
- `board_columns`
- `pilo_issues`

Board API는 GitHub Integration이 동기화한 원본 데이터를 읽어 보드 화면용
캐시를 구성한다. Board issue status 변경, issue title/body/state 수정, issue
생성은 Board API가 소유한다. 댓글, 라벨 변경, 삭제, ProjectV2 field/option
설정 변경은 제외한다.

## 데이터 규칙

- Board는 하나의 `github_projects_v2`와 하나의 `github_repositories` 조합으로 hydrate한다.
- Column은 ProjectV2 Status field option에서 hydrate한다.
- Card는 ProjectV2 item 중 `ISSUE` content만 MVP 보드 카드로 사용한다.
- GitHub에는 `PULL_REQUEST` ProjectV2 item이 있을 수 있지만 MVP Board card는 issue card 기준이다.
- 상태 option에 매핑되지 않는 item은 로컬 `Unmapped` column에 배치한다.
- GitHub sync가 실행 중이거나 실패해도 Board API는 마지막 성공 cache를 반환할 수 있다.
- GitHub 원본 cache는 Workspace 범위로 격리된다. Board hydrate와 write 전제는
  path의 `workspaceId`에 속한 GitHub repository, ProjectV2, issue, PR cache이며,
  다른 Workspace의 GitHub 원본 row를 재사용하거나 재할당하지 않는다.
- Board API는 GitHub를 source of truth로 사용한다.
- GitHub write 성공 후 로컬 `pilo_issues` cache를 갱신한다.
- GitHub write 실패 시 클라이언트는 GitHub 기준으로 rollback 또는 refresh한다.
- Board write API는 현재 사용자의 GitHub App user OAuth token으로 GitHub Issue와
  ProjectV2 mutation을 수행한다.
- API 응답이나 로그에 GitHub token, OAuth code, refresh token, installation token,
  GitHub App private key를 노출하지 않는다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `POST` | `/workspaces/{workspaceId}/boards` | Repository/Project 조합으로 Board 생성 또는 hydrate |
| `GET` | `/workspaces/{workspaceId}/boards` | Board 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}` | Board 상세와 sync 요약 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/columns` | Board column 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues` | Board issue card 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}` | Board issue 상세 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/pull-requests` | 파생 가능한 경우 issue 관련 PR 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/filter-options` | label, assignee, state, column 필터 후보 조회 |
| `PATCH` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status` | Board issue의 ProjectV2 Status 변경 |
| `PATCH` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}` | GitHub issue title/body/state 수정 |
| `POST` | `/workspaces/{workspaceId}/boards/{boardId}/issues` | GitHub issue 생성 후 ProjectV2 column에 배치 |

수동 동기화는 GitHub Integration API를 사용한다.

```http
POST /api/v1/workspaces/{workspaceId}/github/sync-runs
GET /api/v1/workspaces/{workspaceId}/github/sync-runs
GET /api/v1/workspaces/{workspaceId}/github/sync-runs/{syncRunId}
```

## Board 생성 또는 Hydrate

```json
{
  "repositoryId": "repository_uuid",
  "projectV2Id": "project_v2_uuid"
}
```

서버 규칙:

- repository와 project가 같은 workspace에 속하는지 검증한다.
- `(project_v2_id, repository_id)` board가 이미 있으면 재사용한다.
- `boards.name`은 ProjectV2 title에서 가져온다.
- `boards.status_field_id`는 동기화된 Status field로 설정한다.
- `board_columns`, `pilo_issues`를 hydrate한다.
- 새 board면 `201 Created`, 기존 board refresh면 `200 OK`를 반환한다.

## Issue 목록 Query

| Query | 설명 |
| --- | --- |
| `columnId` | 로컬 board column 필터 |
| `state` | GitHub issue state: `open`, `closed` |
| `search` | 제목/본문 검색 |
| `label` | Label name 필터 |
| `assignee` | GitHub login 필터 |
| `page`, `limit` | 페이지네이션 |

## 권한 규칙

- 모든 Board API는 PILO bearer token이 필요하다.
- 현재 사용자는 해당 Workspace에 접근할 수 있어야 한다.
- Board, issue, column은 모두 path의 `workspaceId`와 `boardId` 범위 안에 있어야 한다.
- Board write API는 현재 사용자의 GitHub App user OAuth token이 필요하다.
- 현재 GitHub 사용자가 대상 repository issue write와 ProjectV2 item/status write 권한을
  가져야 한다.
- GitHub provider raw error, token, secret은 응답이나 로그에 노출하지 않는다.

## Write 공통 처리 규칙

- 서버는 먼저 Workspace, Board, issue, column 소유 범위를 검증한다.
- 서버는 GitHub write를 먼저 수행한 뒤 성공한 결과로 로컬 cache를 갱신한다.
- 로컬 cache 갱신 중 실패하면 GitHub source of truth 기준으로 다음 hydrate 또는
  refresh에서 회복할 수 있어야 한다.
- 클라이언트가 optimistic update를 적용한 경우 실패 시 클라이언트는 GitHub 기준으로
  rollback 또는 refresh한다.
- Board write API는 ProjectV2 field/option 생성·수정은 수행하지 않는다. 기존
  Status field와 Status option만 사용한다.

## Issue Status 변경

```http
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status
```

Request:

```json
{
  "columnId": "column_uuid",
  "previousColumnId": "previous_column_uuid"
}
```

규칙:

- 이 API는 ProjectV2 `Status` field value를 변경한다.
- `columnId`는 같은 board에 속한 `board_columns.id`여야 한다.
- `previousColumnId`는 선택값이다. 서버는 값이 있으면 현재 cache의 column과 비교해
  stale move를 감지할 수 있다.
- 대상 column이 ProjectV2 Status option에 매핑되어 있으면 GitHub ProjectV2
  `Status` field value를 변경한다.
- 대상 column이 로컬 `Unmapped` column이면 GitHub ProjectV2 Status value를 clear한다.
- GitHub mutation 성공 후 `github_project_v2_items`와 `pilo_issues.column_id`를
  갱신한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "issue_card_id",
      "boardId": "board_uuid",
      "columnId": "column_uuid",
      "repositoryId": "repository_uuid",
      "githubIssueId": "github_issue_uuid",
      "projectItemId": "project_item_uuid",
      "githubIssueNodeId": "I_kwDOExample",
      "githubProjectItemNodeId": "PVTI_lADOExample",
      "githubIssueNumber": 134,
      "issueNumber": "#134",
      "title": "Board issue card 목록과 필터 구현",
      "htmlUrl": "https://github.com/Developer-EJ/PILO/issues/134",
      "state": "open",
      "labels": [],
      "assignees": [],
      "position": 3,
      "githubUpdatedAt": "2026-07-06T01:04:27.000Z",
      "lastSyncedAt": "2026-07-06T01:05:00.000Z",
      "createdAt": "2026-07-06T01:06:00.000Z",
      "updatedAt": "2026-07-06T01:07:00.000Z"
    },
    "previousColumnId": "previous_column_uuid"
  }
}
```

Status code: `200 OK`

## Issue 수정

```http
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
```

Request:

```json
{
  "title": "OAuth callback state 바인딩 보강",
  "body": "본문 markdown",
  "state": "open"
}
```

규칙:

- `title`, `body`, `state` 중 하나 이상을 보낸다.
- `state`는 `open`, `closed`만 허용한다.
- title/body/state 외 labels, assignees, milestone, comment 변경은 이 API 범위가 아니다.
- 서버는 GitHub Issue를 먼저 수정한 뒤 `github_issues`와 `pilo_issues` cache를 갱신한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "issue_card_id",
      "boardId": "board_uuid",
      "columnId": "column_uuid",
      "repositoryId": "repository_uuid",
      "githubIssueId": "github_issue_uuid",
      "projectItemId": "project_item_uuid",
      "githubIssueNodeId": "I_kwDOExample",
      "githubProjectItemNodeId": "PVTI_lADOExample",
      "githubIssueNumber": 203,
      "issueNumber": "#203",
      "title": "OAuth callback state 바인딩 보강",
      "htmlUrl": "https://github.com/Developer-EJ/PILO/issues/203",
      "state": "open",
      "labels": [],
      "assignees": [],
      "position": 3,
      "githubUpdatedAt": "2026-07-06T13:56:37.000Z",
      "lastSyncedAt": "2026-07-06T13:56:40.000Z",
      "createdAt": "2026-07-06T13:18:39.000Z",
      "updatedAt": "2026-07-06T13:56:40.000Z",
      "body": "본문 markdown",
      "milestone": null,
      "projectFields": []
    }
  }
}
```

Status code: `200 OK`

## Issue 생성

```http
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues
```

Request:

```json
{
  "title": "새 Board issue",
  "body": "본문 markdown",
  "columnId": "column_uuid"
}
```

규칙:

- 서버는 Board가 참조하는 repository와 ProjectV2를 사용한다.
- `title`은 필수다.
- `body`는 선택값이다.
- `columnId`는 같은 board에 속한 `board_columns.id`여야 한다.
- 서버는 GitHub Issue를 생성한 뒤 ProjectV2 item으로 추가한다.
- 서버는 선택한 column의 ProjectV2 `Status` field value를 설정한다.
- GitHub write 성공 후 `github_issues`, `github_project_v2_items`,
  `github_project_v2_item_field_values`, `pilo_issues` cache를 갱신한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "issue_card_id",
      "boardId": "board_uuid",
      "columnId": "column_uuid",
      "repositoryId": "repository_uuid",
      "githubIssueId": "github_issue_uuid",
      "projectItemId": "project_item_uuid",
      "githubIssueNodeId": "I_kwDOExample",
      "githubProjectItemNodeId": "PVTI_lADOExample",
      "githubIssueNumber": 245,
      "issueNumber": "#245",
      "title": "새 Board issue",
      "htmlUrl": "https://github.com/Developer-EJ/PILO/issues/245",
      "state": "open",
      "labels": [],
      "assignees": [],
      "position": 0,
      "githubUpdatedAt": "2026-07-07T04:44:37.000Z",
      "lastSyncedAt": "2026-07-07T04:44:40.000Z",
      "createdAt": "2026-07-07T04:44:37.000Z",
      "updatedAt": "2026-07-07T04:44:40.000Z"
    }
  }
}
```

Status code: `201 Created`

## 오류

| Status | Code | 상황 |
| --- | --- | --- |
| `400 BAD_REQUEST` | `BAD_REQUEST` | request body 또는 query가 잘못됨 |
| `401 UNAUTHORIZED` | `UNAUTHORIZED` | PILO bearer token 없음 또는 만료 |
| `403 FORBIDDEN` | `FORBIDDEN` | Workspace, Board, GitHub repository, ProjectV2 write 권한 없음 |
| `404 NOT_FOUND` | `NOT_FOUND` | Board, issue, column, repository, ProjectV2를 찾을 수 없음 |
| `409 CONFLICT` | `CONFLICT` | `previousColumnId`가 현재 cache와 다르거나 GitHub source가 stale 상태 |
| `502 BAD_GATEWAY` | `BAD_GATEWAY` | GitHub provider write 실패. provider raw error는 노출하지 않음 |

## MVP 제외

```http
DELETE /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/comments
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/labels
DELETE /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/labels/{label}
```

- GitHub repository 생성/삭제
- ProjectV2 field/option 생성/수정
- issue label, assignee, milestone 직접 변경
