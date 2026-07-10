# Board API

## 범위

Board API는 GitHub Project Kanban 화면을 위한 로컬 캐시 API와 제한된 issue write API를 제공한다.

- `boards`
- `board_columns`
- `pilo_issues`

Board API는 GitHub Integration이 동기화한 원본 데이터를 읽어 보드 화면용 캐시를 구성한다. Board issue status 변경, issue title/body/state 수정, issue 생성은 Board API가 소유한다. 댓글, 라벨 변경, 삭제, ProjectV2 field/option 설정 변경은 제외한다.

이 문서는 `apps/app-server/src/modules/board` 구현을 기준으로 한다.

## 데이터 규칙

- Board는 하나의 `github_projects_v2`와 하나의 `github_repositories` 조합으로 hydrate한다.
- Board 생성은 같은 workspace 안에서 repository와 ProjectV2가 `github_project_v2_repositories`로 연결되어 있어야 한다.
- Column은 ProjectV2 Status field option에서 hydrate한다.
- Card는 ProjectV2 item 중 `ISSUE` content만 MVP 보드 카드로 사용한다.
- GitHub에는 `PULL_REQUEST` ProjectV2 item이 있을 수 있지만 MVP Board card는 issue card 기준이다.
- Status option에 매핑되지 않는 item은 로컬 `Unmapped` column에 배치한다.
- GitHub sync가 실행 중이거나 실패해도 Board API는 마지막 성공 cache를 반환할 수 있다.
- GitHub 원본 cache는 Workspace 범위로 격리된다. Board hydrate와 read/write는 path의 `workspaceId`에 속한 GitHub repository, ProjectV2, issue, PR cache만 사용한다.
- Board API는 GitHub를 source of truth로 사용한다.
- GitHub write 성공 후 로컬 `pilo_issues` cache를 갱신한다. 구현에 따라 관련 `github_*`, `board_columns` cache도 함께 갱신한다.
- GitHub write 실패 시 클라이언트는 GitHub 기준으로 rollback 또는 refresh한다.
- Board write API의 GitHub Issue write는 현재 사용자의 GitHub App user OAuth token을 사용한다.
- Board issue 생성과 status 변경의 ProjectV2 item/status write는 `/me/github/project-oauth/start`로 연결한 ProjectV2 OAuth token(`project` scope)을 사용한다.
- API 응답이나 로그에 GitHub token, OAuth code, refresh token, installation token, GitHub App private key를 노출하지 않는다.

## 공통 요청/응답 규칙

- 모든 endpoint는 전역 prefix `/api/v1` 아래에 있다.
- 모든 Board API는 PILO bearer token이 필요하다.
- 모든 Board API는 현재 사용자의 workspace 접근 권한을 확인한다.
- `boardId`, `issueId`, `columnId`, `previousColumnId`는 양의 정수 문자열이다. 응답에서도 로컬 numeric id는 문자열로 직렬화한다.
- `repositoryId`, `projectV2Id`는 GitHub Integration에서 동기화한 로컬 UUID 문자열이다.
- Query string에서 문자열 필터는 trim 후 빈 문자열이면 미적용한다. 배열 또는 잘못된 타입은 `400 BAD_REQUEST`로 거절한다.
- `page`와 `limit`은 양의 정수다. 기본값은 `page=1`, `limit=20`이며 `limit` 최대값은 `100`이다.
- Board 목록과 issue 목록은 service payload를 그대로 `data`에 담는다.

```json
{
  "success": true,
  "data": {
    "data": [],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 0
    }
  }
}
```

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/boards` | Board 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/boards` | Repository/Project 조합으로 Board 생성 또는 hydrate |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}` | Board 상세와 sync 요약 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/columns` | Board column 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues` | Board issue card 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/boards/{boardId}/issues` | GitHub issue 생성 후 ProjectV2 column에 배치 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}` | Board issue 상세 조회 |
| `PATCH` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status` | Board issue의 ProjectV2 Status 변경 |
| `PATCH` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}` | GitHub issue title/body/state 수정 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/pull-requests` | issue 관련 PR 목록 조회 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/filter-options` | column, state, assignee, label 필터 후보 조회 |

수동 동기화는 GitHub Integration API를 사용한다.

```http
POST /api/v1/workspaces/{workspaceId}/github/sync-runs
GET /api/v1/workspaces/{workspaceId}/github/sync-runs
GET /api/v1/workspaces/{workspaceId}/github/sync-runs/{syncRunId}
```

## Board 생성 또는 Hydrate

```http
POST /api/v1/workspaces/{workspaceId}/boards
```

Request:

```json
{
  "repositoryId": "repository_uuid",
  "projectV2Id": "project_v2_uuid"
}
```

서버 규칙:

- Request body는 object여야 한다.
- `repositoryId`, `projectV2Id`는 필수 non-empty string이다.
- repository와 ProjectV2가 같은 workspace에 있고 서로 연결되어 있는지 검증한다.
- 연결된 GitHub repository 또는 ProjectV2가 없으면 `404 NOT_FOUND`와 `GitHub repository or ProjectV2 link not found`를 반환한다.
- 서버는 `hydrate_pilo_board_from_github(projectV2Id, repositoryId)`를 호출해 `boards`, `board_columns`, `pilo_issues`를 hydrate한다.
- `boards.name`은 ProjectV2 title에서 가져온다.
- `boards.status_field_id`는 동기화된 Status field로 설정된다. Status field가 없으면 `statusField`는 `null`일 수 있다.
- 새 board면 `201 Created`, 기존 board refresh면 `200 OK`를 반환한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "id": "42",
    "workspaceId": "workspace_uuid",
    "name": "PILO Board",
    "repository": {
      "id": "repository_uuid",
      "fullName": "Developer-EJ/PILO",
      "htmlUrl": "https://github.com/Developer-EJ/PILO"
    },
    "project": {
      "id": "project_v2_uuid",
      "githubProjectNodeId": "PVT_kwDOExample",
      "projectNumber": 3,
      "title": "PILO Board",
      "url": "https://github.com/users/Developer-EJ/projects/3"
    },
    "statusField": {
      "id": "status_field_uuid",
      "githubFieldNodeId": "PVTSSF_lADOExample",
      "name": "Status"
    },
    "syncStatus": "success",
    "lastSyncedAt": "2026-07-06T01:05:00.000Z",
    "createdAt": "2026-07-06T01:06:00.000Z",
    "updatedAt": "2026-07-06T01:07:00.000Z"
  }
}
```

## Board 목록

```http
GET /api/v1/workspaces/{workspaceId}/boards
```

Query:

| Query | 설명 |
| --- | --- |
| `repositoryId` | 특정 repository의 board만 조회 |
| `projectV2Id` | 특정 ProjectV2의 board만 조회 |
| `page`, `limit` | 페이지네이션. 기본 `1`, `20`, 최대 `100` |

정렬은 `updatedAt DESC`, `id ASC`이다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "42",
        "workspaceId": "workspace_uuid",
        "name": "PILO Board",
        "repository": {
          "id": "repository_uuid",
          "fullName": "Developer-EJ/PILO",
          "htmlUrl": "https://github.com/Developer-EJ/PILO"
        },
        "project": {
          "id": "project_v2_uuid",
          "githubProjectNodeId": "PVT_kwDOExample",
          "projectNumber": 3,
          "title": "PILO Board",
          "url": "https://github.com/users/Developer-EJ/projects/3"
        },
        "statusField": null,
        "syncStatus": "success",
        "lastSyncedAt": "2026-07-06T01:05:00.000Z",
        "createdAt": "2026-07-06T01:06:00.000Z",
        "updatedAt": "2026-07-06T01:07:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 1
    }
  }
}
```

## Board 상세

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}
```

- `boardId`는 양의 정수 문자열이어야 한다.
- board가 workspace에 없으면 `404 NOT_FOUND`와 `Board not found`를 반환한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "id": "42",
    "workspaceId": "workspace_uuid",
    "name": "PILO Board",
    "repository": {
      "id": "repository_uuid",
      "fullName": "Developer-EJ/PILO",
      "htmlUrl": "https://github.com/Developer-EJ/PILO"
    },
    "project": {
      "id": "project_v2_uuid",
      "githubProjectNodeId": "PVT_kwDOExample",
      "projectNumber": 3,
      "title": "PILO Board",
      "url": "https://github.com/users/Developer-EJ/projects/3"
    },
    "statusField": {
      "id": "status_field_uuid",
      "githubFieldNodeId": "PVTSSF_lADOExample",
      "name": "Status"
    },
    "summary": {
      "columnsCount": 4,
      "totalCards": 12,
      "openCards": 10,
      "closedCards": 2
    },
    "sync": {
      "status": "success",
      "lastSyncedAt": "2026-07-06T01:05:00.000Z"
    },
    "createdAt": "2026-07-06T01:06:00.000Z",
    "updatedAt": "2026-07-06T01:07:00.000Z"
  }
}
```

## Board Column 목록

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/columns
```

- `boardId`는 양의 정수 문자열이어야 한다.
- board가 workspace에 없으면 `404 NOT_FOUND`와 `Board not found`를 반환한다.
- 정렬은 `position ASC`, `id ASC`이다.

성공 응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "7",
      "boardId": "42",
      "statusOptionId": "status_option_uuid",
      "githubStatusOptionId": "f75ad846",
      "name": "Todo",
      "normalizedName": "todo",
      "position": 0,
      "color": "BLUE",
      "issueCount": 5
    }
  ]
}
```

## Issue 목록

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues
```

Query:

| Query | 설명 |
| --- | --- |
| `columnId` | 같은 board의 local column id. 양의 정수 문자열 |
| `state` | GitHub issue state. `open`, `closed` |
| `search` | `title` 또는 `body` 부분 일치 검색 |
| `label` | label name 정확히 일치 |
| `assignee` | GitHub login 정확히 일치 |
| `page`, `limit` | 페이지네이션. 기본 `1`, `20`, 최대 `100` |

정렬은 column `position ASC`, issue `position ASC`, issue `id ASC`이다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "101",
        "boardId": "42",
        "columnId": "7",
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
      }
    ],
    "meta": {
      "page": 1,
      "limit": 20,
      "total": 1
    }
  }
}
```

## Issue 상세

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
```

- `boardId`, `issueId`는 양의 정수 문자열이어야 한다.
- issue가 workspace/board에 없으면 `404 NOT_FOUND`와 `Board issue not found`를 반환한다.
- `projectFields`는 `github_project_v2_item_field_values.field_name ASC`로 정렬한다.
- field value가 없으면 해당 optional key는 응답에서 생략한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "id": "101",
    "boardId": "42",
    "columnId": "7",
    "repositoryId": "repository_uuid",
    "githubIssueId": "github_issue_uuid",
    "projectItemId": "project_item_uuid",
    "githubIssueNodeId": "I_kwDOExample",
    "githubProjectItemNodeId": "PVTI_lADOExample",
    "githubIssueNumber": 134,
    "issueNumber": "#134",
    "title": "Board issue card 목록과 필터 구현",
    "body": "본문 markdown",
    "htmlUrl": "https://github.com/Developer-EJ/PILO/issues/134",
    "state": "open",
    "labels": [],
    "assignees": [],
    "milestone": null,
    "position": 3,
    "projectFields": [
      {
        "fieldName": "Status",
        "fieldDataType": "SINGLE_SELECT",
        "singleSelectOptionId": "status_option_uuid",
        "singleSelectName": "Todo"
      }
    ],
    "githubUpdatedAt": "2026-07-06T01:04:27.000Z",
    "lastSyncedAt": "2026-07-06T01:05:00.000Z",
    "createdAt": "2026-07-06T01:06:00.000Z",
    "updatedAt": "2026-07-06T01:07:00.000Z"
  }
}
```

## Issue 관련 Pull Request 목록

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/pull-requests
```

- `boardId`, `issueId`는 양의 정수 문자열이어야 한다.
- issue가 workspace/board에 없으면 `404 NOT_FOUND`와 `Board issue not found`를 반환한다.
- repository id 또는 GitHub issue number가 없으면 빈 배열을 반환한다.
- GitHub API를 호출하지 않고 동기화된 `github_pull_requests` cache를 검색한다.
- PR title/body의 `#issueNumber`, raw payload의 `issues/{issueNumber}`, raw payload의 issue URL을 기준으로 관련 PR을 찾는다.
- 정렬은 `githubUpdatedAt DESC NULLS LAST`, `githubNumber DESC`, `id ASC`이다.

성공 응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "pull_request_uuid",
      "repositoryId": "repository_uuid",
      "githubPullRequestId": 987654321,
      "githubNodeId": "PR_kwDOExample",
      "githubNumber": 135,
      "title": "Fix board issue filters",
      "authorName": "Developer-EJ",
      "authorAvatarUrl": "https://avatars.githubusercontent.com/u/1?v=4",
      "state": "open",
      "draft": false,
      "mergeable": true,
      "createdAtGithub": "2026-07-06T02:00:00.000Z",
      "updatedAtGithub": "2026-07-06T03:00:00.000Z",
      "headBranch": "feat/board-filters",
      "baseBranch": "dev",
      "headSha": "abc123",
      "baseSha": "def456",
      "changedFilesCount": 3,
      "additions": 120,
      "deletions": 10,
      "commitsCount": 2,
      "commentsCount": 1,
      "reviewCommentsCount": 0,
      "githubUrl": "https://github.com/Developer-EJ/PILO/pull/135",
      "lastSyncedAt": "2026-07-06T03:01:00.000Z"
    }
  ]
}
```

## Filter Options

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/filter-options
```

- `boardId`는 양의 정수 문자열이어야 한다.
- board가 workspace에 없으면 `404 NOT_FOUND`와 `Board not found`를 반환한다.
- `columns`는 column `position ASC`, `id ASC`로 정렬한다.
- `states`는 항상 `open`, `closed` 두 값을 반환하며 없는 상태의 count는 `0`이다.
- `assignees`는 login 기준 오름차순, `labels`는 name 기준 오름차순이다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "columns": [
      {
        "id": "7",
        "name": "Todo",
        "normalizedName": "todo",
        "count": 5
      }
    ],
    "states": [
      {
        "value": "open",
        "label": "Open",
        "count": 10
      },
      {
        "value": "closed",
        "label": "Closed",
        "count": 2
      }
    ],
    "assignees": [
      {
        "login": "Developer-EJ",
        "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4",
        "count": 3
      }
    ],
    "labels": [
      {
        "name": "bug",
        "color": "d73a4a",
        "count": 2
      }
    ]
  }
}
```

## 권한 규칙

- 모든 Board API는 PILO bearer token이 필요하다.
- 현재 사용자는 해당 Workspace에 접근할 수 있어야 한다.
- Board, issue, column은 모두 path의 `workspaceId`와 `boardId` 범위 안에 있어야 한다.
- Board read API는 별도 GitHub 호출 없이 로컬 cache를 읽는다.
- Board issue title/body/state 수정은 현재 사용자의 GitHub App user OAuth token이 필요하다.
- Board issue 생성과 status 변경처럼 ProjectV2 item/status write가 필요한 API는 현재 사용자의 ProjectV2 OAuth token(`project` scope)이 필요하다.
- 현재 GitHub 사용자는 대상 repository issue write와 ProjectV2 item/status write 권한을 가져야 한다.
- GitHub provider raw error, token, secret은 응답이나 로그에 노출하지 않는다.

## Write 공통 처리 규칙

- 서버는 먼저 Workspace, Board, issue, column 소유 범위를 검증한다.
- 서버는 GitHub write를 먼저 수행하고 성공한 결과로 로컬 cache를 갱신한다.
- 로컬 cache 갱신 중 실패하면 GitHub source of truth 기준으로 다음 hydrate 또는 refresh에서 복구되어야 한다.
- 클라이언트가 optimistic update를 적용한 경우 실패 시 클라이언트는 GitHub 기준으로 rollback 또는 refresh한다.
- Board write API는 ProjectV2 field/option 생성·수정은 수행하지 않는다. 기존 Status field와 Status option만 사용한다.
- GitHub OAuth 연결 오류는 기존 auth/provider error를 그대로 반환한다.
- 그 외 GitHub provider write 실패는 `502 BAD_GATEWAY`로 매핑한다.

## Issue Status 변경

```http
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status
```

Request:

```json
{
  "columnId": "7",
  "previousColumnId": "6"
}
```

규칙:

- Request body는 object여야 한다.
- `columnId`는 필수 양의 정수 문자열이다.
- `previousColumnId`는 선택 양의 정수 문자열이다.
- `"columnId": "column_uuid"`처럼 UUID placeholder 형태의 값은 허용하지 않는다.
- `"previousColumnId": "previous_column_uuid"`처럼 UUID placeholder 형태의 값은 허용하지 않는다.
- 이 API는 ProjectV2 `Status` field value를 변경한다.
- `columnId`는 같은 board에 속한 `board_columns.id`여야 한다.
- `previousColumnId`가 있으면 서버는 현재 cache의 column과 비교해 stale move를 감지한다.
- `previousColumnId`와 현재 cache column이 다르면 GitHub write 없이 `409 CONFLICT`와 `Board issue column changed before status update`를 반환한다.
- 대상 issue 또는 column이 없으면 `404 NOT_FOUND`와 `Board issue or target column not found`를 반환한다.
- issue 또는 board가 ProjectV2 status metadata를 갖고 있지 않으면 `400 BAD_REQUEST`와 `Board issue is missing GitHub ProjectV2 status metadata`를 반환한다.
- 대상 column이 Status option에 매핑되어 있으나 GitHub option id가 없으면 `400 BAD_REQUEST`와 `Board column is missing GitHub Status option metadata`를 반환한다.
- 대상 column이 ProjectV2 Status option에 매핑되어 있으면 GitHub ProjectV2 `Status` field value를 변경한다.
- 대상 column이 로컬 `Unmapped` column이면 GitHub ProjectV2 Status value를 clear한다.
- GitHub mutation 성공 후 `github_project_v2_items`, `github_project_v2_item_field_values`, `pilo_issues.column_id`를 갱신한다.
- 다른 column으로 이동하면 target column의 마지막 position 뒤로 배치한다. 같은 column이면 기존 position을 유지한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "101",
      "boardId": "42",
      "columnId": "7",
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

- Request body는 object여야 한다.
- `title`, `body`, `state` 중 하나 이상을 보내야 한다.
- `title`은 trim 후 빈 문자열일 수 없고 최대 255자다.
- `body`는 문자열이어야 하며 빈 문자열은 허용한다.
- `state`는 `open`, `closed`만 허용한다.
- title/body/state 외 labels, assignees, milestone, comment 변경은 이 API 범위가 아니다.
- issue가 workspace/board에 없으면 `404 NOT_FOUND`와 `Board issue not found`를 반환한다.
- issue에 GitHub issue metadata가 없으면 `400 BAD_REQUEST`와 `Board issue is missing GitHub issue metadata`를 반환한다.
- 서버는 GitHub Issue를 먼저 수정하고 `github_issues`와 `pilo_issues` cache를 갱신한다.
- GitHub provider write 실패는 `502 BAD_GATEWAY`와 `GitHub issue update failed`로 매핑한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "101",
      "boardId": "42",
      "columnId": "7",
      "repositoryId": "repository_uuid",
      "githubIssueId": "github_issue_uuid",
      "projectItemId": "project_item_uuid",
      "githubIssueNodeId": "I_kwDOExample",
      "githubProjectItemNodeId": "PVTI_lADOExample",
      "githubIssueNumber": 203,
      "issueNumber": "#203",
      "title": "OAuth callback state 바인딩 보강",
      "body": "본문 markdown",
      "htmlUrl": "https://github.com/Developer-EJ/PILO/issues/203",
      "state": "open",
      "labels": [],
      "assignees": [],
      "milestone": null,
      "position": 3,
      "projectFields": [],
      "githubUpdatedAt": "2026-07-06T13:56:37.000Z",
      "lastSyncedAt": "2026-07-06T13:56:40.000Z",
      "createdAt": "2026-07-06T13:18:39.000Z",
      "updatedAt": "2026-07-06T13:56:40.000Z"
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
  "columnId": "7"
}
```

규칙:

- Request body는 object여야 한다.
- 서버는 Board가 참조하는 repository와 ProjectV2를 사용한다.
- `title`은 필수 문자열이며 trim 후 빈 문자열일 수 없고 최대 255자다.
- `body`는 선택 문자열이다.
- `columnId`는 필수 양의 정수 문자열이며 같은 board에 속한 `board_columns.id`여야 한다.
- board 또는 target column이 없으면 `404 NOT_FOUND`와 `Board or target column not found`를 반환한다.
- board에 GitHub repository metadata가 없으면 `400 BAD_REQUEST`와 `Board is missing GitHub repository metadata`를 반환한다.
- board에 ProjectV2 status metadata가 없으면 `400 BAD_REQUEST`와 `Board is missing GitHub ProjectV2 status metadata`를 반환한다.
- 대상 column이 Status option에 매핑되어 있으나 GitHub option id가 없으면 `400 BAD_REQUEST`와 `Board column is missing GitHub Status option metadata`를 반환한다.
- 서버는 ProjectV2 write access를 먼저 확인한다.
- 서버는 GitHub Issue를 생성한 뒤 ProjectV2 item으로 추가한다.
- 서버는 선택한 column의 ProjectV2 `Status` field value를 설정한다.
- GitHub write 성공 후 `github_issues`, `github_project_v2_items`, `github_project_v2_item_field_values`, `pilo_issues` cache를 갱신한다.
- 새 issue의 local position은 target column의 마지막 position 뒤에 배치한다.
- GitHub issue 생성 실패는 `502 BAD_GATEWAY`와 `GitHub issue create failed`로 매핑한다.
- ProjectV2 item 추가 실패는 `502 BAD_GATEWAY`와 `GitHub ProjectV2 item add failed`로 매핑한다.
- ProjectV2 status 변경 실패는 `502 BAD_GATEWAY`와 `GitHub ProjectV2 status update failed`로 매핑한다.

성공 응답:

```json
{
  "success": true,
  "data": {
    "issue": {
      "id": "101",
      "boardId": "42",
      "columnId": "7",
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

Board API 오류 응답은 공통 API 오류 포맷을 따른다.

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "columnId must be a positive integer"
  }
}
```

| Status | Code | 상황 |
| --- | --- | --- |
| `400 BAD_REQUEST` | `BAD_REQUEST` | request body, path id, query가 잘못됨. GitHub metadata가 부족함 |
| `401 UNAUTHORIZED` | `UNAUTHORIZED` | PILO bearer token 없음 또는 만료 |
| `403 FORBIDDEN` | `FORBIDDEN` | Workspace 접근 권한 또는 GitHub write 권한 없음 |
| `404 NOT_FOUND` | `NOT_FOUND` | Board, issue, column, repository, ProjectV2를 찾을 수 없음 |
| `409 CONFLICT` | `CONFLICT` | `previousColumnId`가 현재 cache column과 다름 |
| `502 BAD_GATEWAY` | `BAD_GATEWAY` | GitHub provider write 실패. provider raw error는 노출하지 않음 |

대표 메시지:

| Status | Message |
| --- | --- |
| `400` | `Request body must be an object` |
| `400` | `boardId must be a positive integer` |
| `400` | `issueId must be a positive integer` |
| `400` | `columnId must be a positive integer` |
| `400` | `state must be open or closed` |
| `400` | `limit must be 100 or less` |
| `400` | `At least one of title/body/state is required` |
| `404` | `Board not found` |
| `404` | `Board issue not found` |
| `404` | `Board issue or target column not found` |
| `404` | `Board or target column not found` |
| `404` | `GitHub repository or ProjectV2 link not found` |
| `409` | `Board issue column changed before status update` |
| `502` | `GitHub issue create failed` |
| `502` | `GitHub issue update failed` |
| `502` | `GitHub ProjectV2 item add failed` |
| `502` | `GitHub ProjectV2 status update failed` |

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
- issue comment 생성/수정/삭제
- PR merge/close
