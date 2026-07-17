# Board API

## Active Board Source

`boards` is the cached repository/ProjectV2 Board collection. The shared active
Board is the durable `workspace_board_settings.active_board_id` pointer.

```http
GET /api/v1/workspaces/{workspaceId}/boards/active
PUT /api/v1/workspaces/{workspaceId}/boards/active
```

`GET` is available to workspace members and returns `data: null` when the
workspace has no active Board. `PUT` accepts `{ "repositoryId", "projectV2Id" }`
and is restricted to `workspaces.owner_user_id`; other members receive `403
FORBIDDEN`. The repository/ProjectV2 link is validated and the Board is hydrated
before the pointer changes, so a hydration failure preserves the prior source.
Within the same transition, PILO makes the selected repository/ProjectV2 the
workspace's only ProjectV2 detail selection, removes prior polling schedules,
and queues `project_v2_fields` and `project_v2_items` refreshes after the source
pointer commits. Completed refreshes use the normal Board invalidation flow.

Successful `PUT` returns `{ boardId, workspaceId, repository, project,
updatedByUserId, updatedAt }` and publishes this Redis/socket payload:

```json
{
  "workspaceId": "workspace_uuid",
  "boardId": "42",
  "changedAt": "2026-07-14T00:00:00.000Z"
}
```

Clients join `board:source:join` with `{ workspaceId }` and leave with
`board:source:leave`. Realtime sends `board:source:updated` only to that
workspace source room. It is an invalidation signal: clients refetch `GET
/boards/active`, then leave the former `board:{boardId}` room and join the new
one. `board:invalidated` remains exclusively a Board-content event.

Repository ProjectV2 discovery is metadata-only and happens after repository
selection. Project OAuth must not bulk-fetch or display a personal Project
catalogue or Project items before that selection.

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
- ProjectV2 OAuth authorize scope는 정확히 `read:user user:email project repo`이며 callback과 runtime은 project and repo scopes를 모두 요구한다. 기존 `project`-only 연결은 다시 연결해야 한다.
- Board issue create는 repository issue 생성과 ProjectV2 item/status write에 ProjectV2 OAuth connection(`purpose=project_v2`)을 사용한다.
- Board issue update와 assignee 변경·조회는 GitHub App user OAuth connection(`purpose=app_user`)을 유지한다. PR Review도 `purpose=app_user` 경계를 유지한다.
- The repo scope grants broad read/write access to public and private repositories available to the connected GitHub user.
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
| `PATCH` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}` | GitHub issue title/body/state/assignees 수정 |
| `GET` | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/assignee-options` | 저장소에서 지정 가능한 issue 담당자 후보 조회 |
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
- `lastSyncedAt`은 마지막으로 성공한 Board hydration 시각이다. GitHub polling 또는 webhook refresh가 성공할 때 갱신되며 ProjectV2 메타데이터 동기화 시각과는 별개다.
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

## Board Realtime

Board 화면은 카드 단위 변경사항을 Socket으로 직접 패치하지 않는다. GitHub 이슈를
hydrate한 뒤 보드 스냅샷이 바뀌었다는 신호만 전달하고, 클라이언트는 기존 Board API를
다시 호출해 최신 스냅샷을 표시한다.

### 방 참여와 접근 제어

- Socket.IO handshake에 bearer session이 없거나 유효하지 않으면 연결이 생성되지 않고
  `connect_error`로 `unauthenticated`를 받는다.
- 연결된 클라이언트는 `board:join` 이벤트로 `{ workspaceId, boardId }`를 전송한다.
  boardId is a positive integer string; for example, `"42"`.
- Realtime Server는 `boards.workspace_id`와 요청한 `workspaceId`가 일치하고,
  현재 사용자가 `workspace_members`에 속하는지 확인한 경우에만
  `workspace:{workspaceId}:board:{boardId}` 방에 입장시킨다.
- 입장 성공 시 `board:joined`, 방을 나갈 때는 `board:leave`를 사용한다.
  `board:error` is reserved for invalid payload and forbidden Board join after
  the connection is established.

### 무효화 이벤트

App Server는 GitHub webhook 또는 polling으로
`hydrate_pilo_board_from_github`가 성공하거나 PILO Board issue의 Status 변경이
성공한 뒤 Redis `board:invalidations` 채널에 무효화 메시지를 발행한다. Realtime
Server는 메시지를 검증한 뒤 해당 Board 방에만 `board:invalidated`를 전송한다.

`board:invalidated`의 payload는 다음 최소 필드만 포함한다.

```json
{
  "workspaceId": "workspace UUID",
  "boardId": "42",
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

Raw GitHub payload는 Redis 메시지 또는 Socket 이벤트에 포함하지 않는다. GitHub 응답
원문, 이슈 상세, 카드 목록은 Board API 스냅샷으로만 조회한다.

### 클라이언트 동작

프론트엔드는 초기 `connect`와 reconnect마다 Board 방에 다시 참여한 후 Board API
snapshot을 다시 불러온다. 현재 방과 일치하는 `board:invalidated`를 받았을 때도 같은
snapshot reload를 수행하며, 이벤트 payload로 카드 상태를 부분 수정하지 않는다.

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
- Board issue title/body/state/assignee 수정과 assignee 후보 조회는 현재 사용자의 GitHub App user OAuth token(`purpose=app_user`)이 필요하다.
- Board issue create와 status 변경처럼 ProjectV2 item/status write가 필요한 API는 현재 사용자의 ProjectV2 OAuth token(`purpose=project_v2`)이 필요하다. 이 token은 `project`와 `repo` scopes를 모두 가져야 한다.
- 현재 GitHub 사용자는 대상 repository issue write와 ProjectV2 item/status write 권한을 가져야 한다.
- GitHub provider raw error, token, secret은 응답이나 로그에 노출하지 않는다.

## Write 공통 처리 규칙

- 서버는 먼저 Workspace, Board, issue, column 소유 범위를 검증한다.
- 서버는 GitHub write를 먼저 수행하고 성공한 결과로 로컬 cache를 갱신한다.
- 로컬 cache 갱신 중 실패하면 GitHub source of truth 기준으로 다음 hydrate 또는 refresh에서 복구되어야 한다.
- 클라이언트가 optimistic update를 적용한 경우 실패 시 클라이언트는 GitHub 기준으로 rollback 또는 refresh한다.
- Board write API는 ProjectV2 field/option 생성·수정은 수행하지 않는다. 기존 Status field와 Status option만 사용한다.
- GitHub OAuth refresh가 불가능하면 `400 BAD_REQUEST`와 `GitHub OAuth reconnection is required`를 반환한다.
- GitHub user token으로 수행한 issue create/update, assignee 변경·조회가 `401`을 받으면
  `400 BAD_REQUEST`와 `GitHub OAuth connection is invalid; reconnect is required`를 반환한다.
- GitHub OAuth 연결 오류는 기존 auth/provider error를 그대로 반환한다.
- 위 두 reconnect 오류는 generic GitHub provider 오류의 `502 BAD_GATEWAY` mapping보다 먼저
  보존하므로 Board service boundary에서 다른 메시지나 status로 변환하지 않는다.
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
- `previousColumnId`에도 UUID placeholder 형태의 값은 허용하지 않는다.
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
    "previousColumnId": "6"
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
  "state": "open",
  "assignees": ["Developer-EJ"]
}
```

규칙:

- Request body는 object여야 한다.
- `title`, `body`, `state`, `assignees` 중 하나 이상을 보내야 한다.
- `title`은 trim 후 빈 문자열일 수 없고 최대 255자다.
- `body`는 문자열이어야 하며 빈 문자열은 허용한다.
- `state`는 `open`, `closed`만 허용한다.
- `assignees`는 GitHub login 문자열 배열이며 최대 10개다. 각 login은 trim하고 대소문자 구분 없이 중복을 제거한다.
- `assignees`는 현재 목록 전체를 교체한다. 빈 배열을 보내면 모든 담당자를 해제한다.
- 저장소에 지정할 수 없는 login이 포함되면 `400 BAD_REQUEST`와 `One or more assignees cannot be assigned to this repository`를 반환한다.
- GitHub가 권한 부족으로 담당자 변경을 적용하지 않으면 `403 FORBIDDEN`과 `GitHub Issue assignee update was not applied`를 반환한다.
- title/body/state/assignees 외 labels, milestone, comment 변경은 이 API 범위가 아니다.
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
      "assignees": [
        {
          "login": "Developer-EJ",
          "avatar_url": "https://avatars.githubusercontent.com/u/1?v=4"
        }
      ],
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

## Issue 담당자 후보 조회

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/assignee-options
```

이슈가 속한 저장소에 지정 가능한 GitHub 사용자 목록을 반환한다. Board의 기존
`filter-options.assignees`와 달리 현재 Board에 이미 배정된 사용자만 집계하지 않는다.

규칙:

- 현재 사용자는 Workspace에 접근할 수 있어야 한다.
- `boardId`, `issueId`는 양의 정수 문자열이어야 한다.
- issue가 workspace/board에 없으면 `404 NOT_FOUND`와 `Board issue not found`를 반환한다.
- issue에 GitHub repository metadata가 없으면 `400 BAD_REQUEST`와 `Board issue is missing GitHub repository metadata`를 반환한다.
- 현재 사용자의 GitHub App user OAuth token으로 저장소의 assignable user를 조회한다.
- GitHub provider 조회 실패는 `502 BAD_GATEWAY`와 `GitHub issue assignee lookup failed`로 매핑한다.
- 후보는 GitHub login 기준 오름차순으로 정렬한다.

성공 응답:

```json
{
  "success": true,
  "data": [
    {
      "login": "Developer-EJ",
      "avatarUrl": "https://avatars.githubusercontent.com/u/1?v=4"
    }
  ]
}
```

Status code: `200 OK`

## Issue 생성

```http
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
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
- `Idempotency-Key`는 필수 HTTP header다. trim 후 UTF-8 기준 1~128 bytes여야 하며 누락되거나 형식이 잘못되면 `400 BAD_REQUEST`를 반환한다.
- operation 범위는 같은 Workspace, 현재 사용자, `Idempotency-Key` 조합이다.
- 요청 동일성은 `boardId`, `columnId`, trim한 `title`, `body`를 정규화한 hash로 판단한다.
- 같은 key와 같은 요청이 이미 성공했으면 기존 성공 응답과 `201 Created`를 반환하며 GitHub write를 다시 호출하지 않는다.
- 같은 key와 다른 요청이면 `409 CONFLICT`를 반환한다.
- 같은 key의 operation이 유효한 lease를 가진 `processing` 상태면 `409 CONFLICT`를 반환한다.
- `retryable` 상태이거나 `processing` lease가 만료된 operation은 마지막 완료 checkpoint부터 이어서 처리한다.
- 서버는 Board가 참조하는 repository와 ProjectV2를 사용한다.
- Meeting 후속 작업의 Pilo issue 선택 목록은 이 생성 API가 사용하는 target 조회와 검증을
  그대로 재사용한다. repository와 ProjectV2 Status metadata가 유효하고, 매핑된 Status
  option이 있으면 GitHub option id까지 존재하는 Column만 생성 가능 대상으로 본다.
- repository와 ProjectV2는 모두 active GitHub App installation에 연결되어 있어야 하며
  두 `installation_id`가 동일해야 한다. installation 삭제로 둘 중 하나가 분리됐거나
  서로 다른 installation을 가리키면 최종 생성 검증과 선택 목록에서 모두 거부한다.
- 생성 가능한 Column이 하나도 없는 Board는 선택 목록에서 제외한다. 로컬 `Unmapped`
  Column처럼 Status option 자체가 없는 Column은 기존 생성 검증과 동일하게 허용한다.
- 선택 목록은 Board id를 identity로 사용하며 Board 이름으로 중복 제거하지 않는다.
- 선택 목록 응답은 Board/Column의 `id`, `name`만 반환하며 repository, ProjectV2,
  installation 내부 metadata는 노출하지 않는다. 생성 가능한 대상이 없으면 오류 대신
  `200 OK`와 `{ "boards": [] }`를 반환한다.
- `title`은 필수 문자열이며 trim 후 빈 문자열일 수 없고 최대 255자다.
- `body`는 선택 문자열이다.
- `columnId`는 필수 양의 정수 문자열이며 같은 board에 속한 `board_columns.id`여야 한다.
- board 또는 target column이 없으면 `404 NOT_FOUND`와 `Board or target column not found`를 반환한다.
- board에 GitHub repository metadata가 없으면 `400 BAD_REQUEST`와 `Board is missing GitHub repository metadata`를 반환한다.
- board에 ProjectV2 status metadata가 없으면 `400 BAD_REQUEST`와 `Board is missing GitHub ProjectV2 status metadata`를 반환한다.
- repository 또는 ProjectV2가 active installation에서 분리됐으면 `400 BAD_REQUEST`와 `Board is disconnected from its GitHub installation`을 반환한다.
- repository와 ProjectV2가 서로 다른 installation에 연결됐으면 `400 BAD_REQUEST`와 `Board repository and ProjectV2 installations do not match`를 반환한다.
- 대상 column이 Status option에 매핑되어 있으나 GitHub option id가 없으면 `400 BAD_REQUEST`와 `Board column is missing GitHub Status option metadata`를 반환한다.
- 서버는 ProjectV2 write access를 먼저 확인한다.
- 서버는 Board issue create의 GitHub repository issue write에도 같은 `purpose=project_v2` token을 사용한다.
- 서버는 GitHub Issue를 생성한 뒤 ProjectV2 item으로 추가한다.
- 서버는 선택한 column의 ProjectV2 `Status` field value를 설정한다.
- GitHub write 성공 후 `github_issues`, `github_project_v2_items`, `github_project_v2_item_field_values`, `pilo_issues` cache를 갱신한다.
- checkpoint 순서는 GitHub Issue 생성, ProjectV2 item 추가, Status 변경, local cache 저장이다.
- local cache upsert와 operation 성공 처리는 하나의 DB transaction으로 반영한다.
- full sync가 먼저 같은 remote object를 저장했더라도 remote node id 기준 upsert로 수렴한 뒤 operation을 완료한다.
- operation에는 provider raw error, token, secret을 저장하지 않고 안전한 오류 code와 message만 저장한다.
- GitHub Issue 생성 응답을 받지 못한 경우에는 원격 Issue 식별자를 저장할 수 없으므로 이 API의 checkpoint 복구 범위에 포함하지 않는다.
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
| `400 BAD_REQUEST` | `BAD_REQUEST` | request body, path id, query, `Idempotency-Key`가 잘못됨. GitHub metadata가 부족하거나 GitHub OAuth 재연결이 필요함 |
| `401 UNAUTHORIZED` | `UNAUTHORIZED` | PILO bearer token 없음 또는 만료 |
| `403 FORBIDDEN` | `FORBIDDEN` | Workspace 접근 권한 또는 GitHub write 권한 없음 |
| `404 NOT_FOUND` | `NOT_FOUND` | Board, issue, column, repository, ProjectV2를 찾을 수 없음 |
| `409 CONFLICT` | `CONFLICT` | `previousColumnId`가 현재 cache column과 다름. 같은 idempotency key의 payload가 다르거나 operation이 처리 중임 |
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
| `400` | `At least one of title/body/state/assignees is required` |
| `400` | `assignees must be an array of GitHub logins` |
| `400` | `assignees must contain 10 or fewer GitHub logins` |
| `400` | `One or more assignees cannot be assigned to this repository` |
| `400` | `GitHub OAuth reconnection is required` |
| `400` | `GitHub OAuth connection is invalid; reconnect is required` |
| `404` | `Board not found` |
| `404` | `Board issue not found` |
| `404` | `Board issue or target column not found` |
| `404` | `Board or target column not found` |
| `404` | `GitHub repository or ProjectV2 link not found` |
| `409` | `Board issue column changed before status update` |
| `403` | `GitHub Issue assignee update was not applied` |
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
- issue label, milestone 직접 변경
- issue comment 생성/수정/삭제
- PR merge/close
