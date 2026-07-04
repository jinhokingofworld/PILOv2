# Board API Spec

작성일: 2026-07-03

## 1. 문서 범위

이 문서는 PILO의 Board 도메인 API를 정의한다. Board API는 GitHub Repository와 GitHub Projects v2를 PILO의 로컬 칸반 보드로 연결하고, 보드 화면에 필요한 컬럼, 이슈 카드, 필터 후보, 로컬 동기화 상태를 제공한다.

이 문서의 source of truth는 다음 문서와 DB schema다.

- `GITHUB_INTEGRATION_API_SPEC.md`
- `PR_REVIEW_API_SPEC.md`
- Consolidated PostgreSQL schema

이 문서가 소유하는 범위는 다음과 같다.

- `boards`, `board_columns`, `pilo_issues` 기반 Board 연결, 조회, 캐시 hydrate
- GitHub Projects v2 Status option을 Board column으로 보여주는 읽기 API
- GitHub Issue 기반 Board card 목록과 상세 조회
- Board 화면용 filter option 조회

이 문서가 소유하지 않는 범위는 다음과 같다.

- GitHub App installation, repository, ProjectV2, Issue, Pull Request 원본 조회와 동기화
- GitHub 수동 동기화 실행과 sync run 이력 조회
- PR 리뷰 세션, AI 리뷰 결과, 리뷰 Flow/File/Canvas, 파일별 리뷰 판단
- GitHub Review 제출과 제출 이력
- GitHub webhook 수신
- 이슈 생성, 수정, 삭제, 상태 변경, 드래그 앤 드롭 저장, 댓글/라벨 변경 같은 GitHub write API

GitHub 원본 데이터와 수동 동기화는 `GITHUB_INTEGRATION_API_SPEC.md`가 정의한다. PR 리뷰 기능은 `PR_REVIEW_API_SPEC.md`가 정의한다.

## 2. 연동 경계

Board API는 GitHub 원본을 직접 소유하지 않는다. GitHub Integration API가 동기화한 로컬 테이블을 읽고, Board 전용 캐시 테이블을 hydrate한다.

| 기능                          | 담당 문서              | API 또는 테이블                                                                          |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Repository 목록/상세          | GitHub Integration API | `GET /workspaces/{workspaceId}/github/repositories`                                      |
| ProjectV2 목록/상세/필드/옵션 | GitHub Integration API | `GET /workspaces/{workspaceId}/github/projects-v2...`                                    |
| ProjectV2 kanban 원본 조회    | GitHub Integration API | `GET /workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/kanban`                  |
| GitHub Issue 원본 상세        | GitHub Integration API | `GET /workspaces/{workspaceId}/github/issues/{issueId}`                                  |
| GitHub PR 원본 목록/상세      | GitHub Integration API | `GET /workspaces/{workspaceId}/github/repositories/{repositoryId}/pull-requests`         |
| GitHub 수동 동기화            | GitHub Integration API | `POST /workspaces/{workspaceId}/github/sync-runs`                                        |
| Board 연결/조회/컬럼/카드     | Board API              | 이 문서                                                                                  |
| PR 리뷰 세션/제출             | PR Review API          | `POST /workspaces/{workspaceId}/github/pull-requests/{pullRequestId}/review-sessions` 등 |

## 3. 데이터 모델 기준

Board API는 다음 테이블을 주로 사용한다.

| 테이블                            | 용도                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `boards`                          | workspace, repository, ProjectV2, Status field 연결과 마지막 hydrate 상태 |
| `board_columns`                   | ProjectV2 Status field option을 Board column으로 캐시                     |
| `pilo_issues`                     | ProjectV2 item 중 `ISSUE` content를 Board card로 캐시                     |
| `github_repositories`             | Repository source of truth                                                |
| `github_projects_v2`              | ProjectV2 source of truth                                                 |
| `github_project_v2_repositories`  | ProjectV2와 Repository 연결 검증                                          |
| `github_project_v2_fields`        | Status field 검증                                                         |
| `github_project_v2_field_options` | Status option source of truth                                             |
| `github_project_v2_items`         | Project item source of truth                                              |
| `github_issues`                   | Issue source of truth                                                     |
| `github_pull_requests`            | PR source of truth                                                        |
| `github_sync_runs`                | GitHub Integration API가 소유하는 sync run 이력                           |

주요 제약은 다음과 같다.

- 하나의 `project_v2_id`와 `repository_id` 조합에는 하나의 board만 존재한다.
- `board_columns`는 `board_id`, `position` 조합이 유일하다.
- `board_columns`는 `board_id`, `status_option_id` 조합이 유일하다.
- `pilo_issues`는 `board_id`, `issue_number` 조합이 유일하다.
- `pilo_issues`는 `board_id`, `github_issue_id` 조합이 유일하다.
- `pilo_issues`는 `board_id`, `project_item_id` 조합이 유일하다.
- `pilo_issues.column_id`는 같은 `board_id`에 속한 `board_columns.id`만 참조할 수 있다.

## 4. 공통 규칙

### Base URL

```text
/api/v1
```

### 경로 규칙

Board API는 workspace 범위 API다. 모든 Board API는 다음 prefix를 사용한다.

```text
/workspaces/{workspaceId}
```

예:

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}
```

### 인증과 권한

- 모든 Board API는 인증된 사용자만 호출할 수 있다.
- 호출 사용자는 대상 `workspaceId`에 접근 권한을 가져야 한다.
- Board가 참조하는 repository와 ProjectV2는 같은 workspace에 속해야 한다.
- GitHub App installation이 suspended 상태이거나 repository selection에서 제외되면 Board 조회는 권한 검사를 다시 수행한다.
- `id` 필드는 클라이언트에서 불투명 식별자로 취급한다.

### 공통 성공 응답

GitHub Integration API와 동일하게 `success`, `data`, `meta` 포맷을 사용한다.

```json
{
  "success": true,
  "data": {},
  "meta": {}
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

### 공통 실패 응답

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message"
  }
}
```

### 페이지네이션

목록 API는 `page`, `limit` query parameter를 사용한다.

| 필드    | 타입   | 기본값 | 설명                       |
| ------- | ------ | ------ | -------------------------- |
| `page`  | number | `1`    | 1부터 시작하는 페이지 번호 |
| `limit` | number | `20`   | 페이지당 항목 수           |

### 시간 형식

모든 시간 필드는 ISO 8601 UTC 문자열을 사용한다.

```text
2026-07-02T05:20:00.000Z
```

### ID 표현

API 응답의 모든 ID는 문자열로 반환한다. `boards.id`, `board_columns.id`, `pilo_issues.id`는 DB에서 `BIGINT`지만 API에서는 문자열이다.

```json
{
  "id": "1",
  "boardId": "1",
  "columnId": "3"
}
```

GitHub node id와 GitHub option id는 별도 필드로 반환한다.

## 5. 상태값

| 필드                     | 값                                  |
| ------------------------ | ----------------------------------- |
| `syncStatus`             | `running`, `success`, `failed`      |
| `issueState`             | `open`, `closed`                    |
| `projectItemContentType` | Board card는 MVP에서 `ISSUE`만 포함 |

`syncStatus`는 `boards.last_sync_status` 또는 관련 `github_sync_runs.status`에서 온다. `clean`, `partial`, `queued`는 Board API의 sync 상태로 사용하지 않는다.

GitHub sync target 값은 GitHub Integration API와 동일하다.

| 값                  | 의미                                |
| ------------------- | ----------------------------------- |
| `repositories`      | repository metadata 동기화          |
| `issues`            | GitHub issues 동기화                |
| `project_v2`        | ProjectV2 metadata 동기화           |
| `project_v2_fields` | ProjectV2 fields/options 동기화     |
| `project_v2_items`  | ProjectV2 items/field values 동기화 |
| `full`              | 위 대상 전체 동기화                 |

## 6. API 목록

| Method | Endpoint                                                                    | 설명                                                    |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `POST` | `/workspaces/{workspaceId}/boards`                                          | Repository와 ProjectV2 조합으로 Board 생성 또는 hydrate |
| `GET`  | `/workspaces/{workspaceId}/boards`                                          | 접근 가능한 Board 목록 조회                             |
| `GET`  | `/workspaces/{workspaceId}/boards/{boardId}`                                | Board 상세와 요약 조회                                  |
| `GET`  | `/workspaces/{workspaceId}/boards/{boardId}/columns`                        | Board column 목록 조회                                  |
| `GET`  | `/workspaces/{workspaceId}/boards/{boardId}/issues`                         | Board issue card 목록 조회                              |
| `GET`  | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}`               | Board issue 상세 조회                                   |
| `GET`  | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/pull-requests` | Issue 관련 PR 목록 조회                                 |
| `GET`  | `/workspaces/{workspaceId}/boards/{boardId}/filter-options`                 | Board filter option 조회                                |

Board API는 `sync-runs` endpoint를 소유하지 않는다. 수동 동기화는 GitHub Integration API의 `/workspaces/{workspaceId}/github/sync-runs`를 사용한다.

## 7. Board 생성 또는 Hydrate

| 항목        | 내용                                                      |
| ----------- | --------------------------------------------------------- |
| Method      | `POST`                                                    |
| Endpoint    | `/workspaces/{workspaceId}/boards`                        |
| 주요 테이블 | `boards`, `board_columns`, `pilo_issues`, `activity_logs` |

선택한 repository와 GitHub Projects v2 조합을 PILO Board로 연결한다. 같은 repository와 project 조합의 board가 이미 있으면 새로 만들지 않고 기존 board를 hydrate한 뒤 반환한다.

### Headers

| 이름              | 필수 | 설명                            |
| ----------------- | ---- | ------------------------------- |
| `Idempotency-Key` | 권장 | 같은 생성 요청의 중복 실행 방지 |

### Request Body

```json
{
  "repositoryId": "repo_123",
  "projectV2Id": "proj_123"
}
```

| 필드           | 타입   | 필수 | 설명                     |
| -------------- | ------ | ---- | ------------------------ |
| `repositoryId` | string | Y    | `github_repositories.id` |
| `projectV2Id`  | string | Y    | `github_projects_v2.id`  |

`name`, `statusFieldId`, `columns`는 request body로 받지 않는다. 서버가 동기화된 GitHub Project title, Status field, Status field option에서 hydrate한다.

### 처리 규칙

1. `workspaceId` 접근 권한을 확인한다.
2. `repositoryId`가 같은 workspace의 `github_repositories.id`인지 확인한다.
3. `projectV2Id`가 같은 workspace의 `github_projects_v2.id`인지 확인한다.
4. `github_project_v2_repositories`에서 project와 repository 연결을 확인한다.
5. 같은 `project_v2_id`, `repository_id` board가 있으면 update, 없으면 create한다.
6. `github_project_v2_fields.is_status_field = true`인 field를 `boards.status_field_id`로 저장한다.
7. `github_project_v2_field_options`를 `board_columns`로 upsert한다.
8. `Unmapped` column이 없으면 `normalized_name = "unmapped"`로 생성한다.
9. `github_project_v2_items.content_type = "ISSUE"`이고 `is_archived = false`인 item만 `pilo_issues`로 hydrate한다.
10. `DRAFT_ISSUE`, `UNKNOWN`, `PULL_REQUEST` Project item은 MVP Board card로 만들지 않는다.

### Response Body

새 board가 생성되면 `201 Created`, 기존 board가 hydrate되면 `200 OK`를 반환한다.

```json
{
  "success": true,
  "data": {
    "id": "1",
    "workspaceId": "ws_123",
    "name": "PILO MVP",
    "repository": {
      "id": "repo_123",
      "fullName": "my-team/pilo",
      "htmlUrl": "https://github.com/my-team/pilo"
    },
    "project": {
      "id": "proj_123",
      "githubProjectNodeId": "PVT_kwDOExample",
      "projectNumber": 1,
      "title": "PILO MVP",
      "url": "https://github.com/orgs/my-team/projects/1"
    },
    "statusField": {
      "id": "field_123",
      "githubFieldNodeId": "PVTSSF_lADOExample",
      "name": "Status"
    },
    "syncStatus": "success",
    "lastSyncedAt": "2026-07-02T05:20:00.000Z",
    "createdAt": "2026-07-02T05:21:00.000Z",
    "updatedAt": "2026-07-02T05:21:00.000Z"
  }
}
```

## 8. Board 목록 조회

| 항목        | 내용                                                  |
| ----------- | ----------------------------------------------------- |
| Method      | `GET`                                                 |
| Endpoint    | `/workspaces/{workspaceId}/boards`                    |
| 주요 테이블 | `boards`, `github_repositories`, `github_projects_v2` |

현재 사용자가 접근 가능한 workspace의 Board 목록을 반환한다.

### Query Params

| 이름           | 타입   | 필수 | 설명                           |
| -------------- | ------ | ---- | ------------------------------ |
| `repositoryId` | string | N    | 특정 repository의 board만 조회 |
| `projectV2Id`  | string | N    | 특정 ProjectV2의 board만 조회  |
| `page`         | number | N    | 페이지 번호                    |
| `limit`        | number | N    | 페이지당 항목 수               |

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "name": "PILO MVP",
      "repository": {
        "id": "repo_123",
        "fullName": "my-team/pilo",
        "htmlUrl": "https://github.com/my-team/pilo"
      },
      "project": {
        "id": "proj_123",
        "githubProjectNodeId": "PVT_kwDOExample",
        "title": "PILO MVP",
        "url": "https://github.com/orgs/my-team/projects/1"
      },
      "syncStatus": "success",
      "lastSyncedAt": "2026-07-02T05:20:00.000Z",
      "createdAt": "2026-07-02T05:21:00.000Z",
      "updatedAt": "2026-07-02T05:21:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

## 9. Board 상세 조회

| 항목        | 내용                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Method      | `GET`                                                                                                             |
| Endpoint    | `/workspaces/{workspaceId}/boards/{boardId}`                                                                      |
| 주요 테이블 | `boards`, `board_columns`, `pilo_issues`, `github_repositories`, `github_projects_v2`, `github_project_v2_fields` |

Board header, 연결된 repository/project, Status field, 카드 요약, 마지막 hydrate 상태를 반환한다.

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "1",
    "workspaceId": "ws_123",
    "name": "PILO MVP",
    "repository": {
      "id": "repo_123",
      "fullName": "my-team/pilo",
      "htmlUrl": "https://github.com/my-team/pilo"
    },
    "project": {
      "id": "proj_123",
      "githubProjectNodeId": "PVT_kwDOExample",
      "projectNumber": 1,
      "title": "PILO MVP",
      "url": "https://github.com/orgs/my-team/projects/1"
    },
    "statusField": {
      "id": "field_123",
      "githubFieldNodeId": "PVTSSF_lADOExample",
      "name": "Status"
    },
    "summary": {
      "columnsCount": 4,
      "totalCards": 34,
      "openCards": 30,
      "closedCards": 4
    },
    "sync": {
      "status": "success",
      "lastSyncedAt": "2026-07-02T05:20:00.000Z"
    },
    "createdAt": "2026-07-02T05:21:00.000Z",
    "updatedAt": "2026-07-02T05:21:00.000Z"
  }
}
```

### 요약 계산 규칙

| 필드           | 계산 기준                                |
| -------------- | ---------------------------------------- |
| `columnsCount` | `board_columns.board_id = boardId` count |
| `totalCards`   | `pilo_issues.board_id = boardId` count   |
| `openCards`    | `pilo_issues.state = "open"` count       |
| `closedCards`  | `pilo_issues.state = "closed"` count     |

`blocked`, `dueSoon`, `reviewDecision`, `checksStatus`는 Board table의 first-class field가 아니므로 Board 상세의 기본 summary에 포함하지 않는다. 필요하면 별도 파생 API에서 정의한다.

## 10. Board Column 목록 조회

| 항목        | 내용                                                 |
| ----------- | ---------------------------------------------------- |
| Method      | `GET`                                                |
| Endpoint    | `/workspaces/{workspaceId}/boards/{boardId}/columns` |
| 주요 테이블 | `board_columns`, `pilo_issues`                       |

Board column 목록과 column별 issue count를 반환한다. 응답은 `position ASC`로 정렬한다.

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "boardId": "1",
      "statusOptionId": "opt_1",
      "githubStatusOptionId": "option_backlog",
      "name": "Backlog",
      "normalizedName": "backlog",
      "position": 0,
      "color": "GRAY",
      "issueCount": 7
    },
    {
      "id": "2",
      "boardId": "1",
      "statusOptionId": null,
      "githubStatusOptionId": null,
      "name": "Unmapped",
      "normalizedName": "unmapped",
      "position": 99,
      "color": "#8a93a6",
      "issueCount": 1
    }
  ]
}
```

### 컬럼 규칙

- Status option 기반 column은 `statusOptionId`와 `githubStatusOptionId`를 가진다.
- `Unmapped` column은 `statusOptionId = null`, `githubStatusOptionId = null`, `normalizedName = "unmapped"`를 가진다.
- `position`은 0 이상의 정수다.

## 11. Board Issue 목록 조회

| 항목        | 내용                                                |
| ----------- | --------------------------------------------------- |
| Method      | `GET`                                               |
| Endpoint    | `/workspaces/{workspaceId}/boards/{boardId}/issues` |
| 주요 테이블 | `pilo_issues`, `board_columns`                      |

Board card 렌더링에 필요한 issue 목록을 반환한다. 기본 정렬은 `column.position ASC`, `pilo_issues.position ASC`다.

### Query Params

| 이름        | 타입   | 필수 | 설명                             |
| ----------- | ------ | ---- | -------------------------------- |
| `columnId`  | string | N    | 특정 column의 issue만 조회       |
| `state`     | string | N    | `open`, `closed`                 |
| `search`    | string | N    | issue number, title, body 검색   |
| `assignee`  | string | N    | GitHub login 기준 필터           |
| `label`     | string | N    | GitHub label name 기준 필터      |
| `milestone` | string | N    | GitHub milestone title 기준 필터 |
| `page`      | number | N    | 페이지 번호                      |
| `limit`     | number | N    | 페이지당 항목 수. 기본값 `20`    |

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "482",
      "boardId": "1",
      "columnId": "2",
      "repositoryId": "repo_123",
      "githubIssueId": "issue_482",
      "projectItemId": "item_482",
      "githubIssueNodeId": "I_kwDOExample",
      "githubProjectItemNodeId": "PVTI_lADOExample",
      "githubIssueNumber": 482,
      "issueNumber": "#482",
      "title": "OAuth callback state 검증 실패",
      "state": "open",
      "position": 1,
      "htmlUrl": "https://github.com/my-team/pilo/issues/482",
      "labels": [
        {
          "name": "auth",
          "color": "ededed"
        }
      ],
      "assignees": [
        {
          "login": "kjh",
          "avatarUrl": "https://avatars.githubusercontent.com/u/123?v=4"
        }
      ],
      "githubUpdatedAt": "2026-07-02T05:10:00.000Z",
      "lastSyncedAt": "2026-07-02T05:20:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

### 목록 응답 규칙

- Board issue 목록은 `pilo_issues` cache를 기준으로 한다.
- 목록 응답은 `raw` metadata 전체를 반환하지 않는다.
- `issueNumber`는 `#482`처럼 표시용 문자열이다.
- `githubIssueNumber`는 GitHub numeric issue number다.
- ProjectV2 item이 archive되거나 더 이상 board repository의 issue를 가리키지 않으면 다음 hydrate 때 `pilo_issues`에서 제거된다.

## 12. Board Issue 상세 조회

| 항목        | 내용                                                          |
| ----------- | ------------------------------------------------------------- |
| Method      | `GET`                                                         |
| Endpoint    | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}` |
| 주요 테이블 | `pilo_issues`, `github_project_v2_item_field_values`          |

Board issue 상세 패널에 필요한 본문, labels, assignees, milestone, Project field values를 반환한다.

### Response Body

```json
{
  "success": true,
  "data": {
    "id": "482",
    "boardId": "1",
    "columnId": "2",
    "repositoryId": "repo_123",
    "githubIssueId": "issue_482",
    "projectItemId": "item_482",
    "githubIssueNodeId": "I_kwDOExample",
    "githubProjectItemNodeId": "PVTI_lADOExample",
    "githubIssueNumber": 482,
    "issueNumber": "#482",
    "title": "OAuth callback state 검증 실패",
    "body": "OAuth callback state 검증 실패가 일부 설치 플로우에서 재현됩니다.",
    "state": "open",
    "htmlUrl": "https://github.com/my-team/pilo/issues/482",
    "labels": [
      {
        "name": "auth",
        "color": "ededed"
      }
    ],
    "assignees": [
      {
        "login": "kjh",
        "avatarUrl": "https://avatars.githubusercontent.com/u/123?v=4"
      }
    ],
    "milestone": null,
    "position": 1,
    "projectFields": [
      {
        "fieldName": "Priority",
        "fieldDataType": "SINGLE_SELECT",
        "singleSelectOptionId": "priority_high",
        "singleSelectName": "High"
      },
      {
        "fieldName": "Due date",
        "fieldDataType": "DATE",
        "dateValue": "2026-07-08"
      }
    ],
    "githubUpdatedAt": "2026-07-02T05:10:00.000Z",
    "lastSyncedAt": "2026-07-02T05:20:00.000Z",
    "createdAt": "2026-07-02T05:21:00.000Z",
    "updatedAt": "2026-07-02T05:21:00.000Z"
  }
}
```

### Project field value 규칙

`projectFields`는 `github_project_v2_item_field_values`에서 조회한다. 필드별 값은 존재하는 타입에 맞는 속성만 채운다.

| DB field                  | API field              |
| ------------------------- | ---------------------- |
| `field_name`              | `fieldName`            |
| `field_data_type`         | `fieldDataType`        |
| `text_value`              | `textValue`            |
| `number_value`            | `numberValue`          |
| `date_value`              | `dateValue`            |
| `single_select_option_id` | `singleSelectOptionId` |
| `single_select_name`      | `singleSelectName`     |
| `iteration_id`            | `iterationId`          |
| `iteration_title`         | `iterationTitle`       |

서버는 `pilo_issues.raw` 또는 GitHub 원본 raw metadata 전체를 그대로 반환하지 않는다.

## 13. Issue 관련 PR 목록 조회

| 항목        | 내용                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| Method      | `GET`                                                                       |
| Endpoint    | `/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/pull-requests` |
| 주요 테이블 | `github_pull_requests`, `pilo_issues`                                       |

Issue와 관련된 Pull Request 목록을 반환한다. DB schema에는 issue-PR 전용 relation table이 없으므로 이 API는 GitHub에서 동기화된 PR metadata 또는 `raw`에 포함된 closing/reference 정보를 기반으로 파생한다. 파생 가능한 정보가 없으면 빈 배열을 반환한다.

PR 원본 조회와 PR 상세 스키마는 GitHub Integration API를 따른다.

### Response Body

```json
{
  "success": true,
  "data": [
    {
      "id": "pr_88",
      "repositoryId": "repo_123",
      "githubNumber": 88,
      "title": "Fix OAuth callback state validation",
      "authorName": "kjh",
      "authorAvatarUrl": "https://avatars.githubusercontent.com/u/123?v=4",
      "state": "open",
      "draft": false,
      "headBranch": "fix/oauth-callback-state",
      "baseBranch": "main",
      "headSha": "abc123",
      "baseSha": "def456",
      "mergedAt": null,
      "githubUrl": "https://github.com/my-team/pilo/pull/88",
      "updatedAtGithub": "2026-07-02T05:15:00.000Z",
      "lastSyncedAt": "2026-07-02T05:20:00.000Z"
    }
  ]
}
```

### 상태 규칙

- `state`는 GitHub Integration API와 같이 `open` 또는 `closed`를 사용한다.
- merge 여부는 별도 `mergedAt`으로 표현한다.
- `reviewDecision`, `checksStatus`는 DB schema의 first-class field가 아니므로 이 API의 기본 응답에 포함하지 않는다.

## 14. Filter Option 조회

| 항목        | 내용                                                        |
| ----------- | ----------------------------------------------------------- |
| Method      | `GET`                                                       |
| Endpoint    | `/workspaces/{workspaceId}/boards/{boardId}/filter-options` |
| 주요 테이블 | `pilo_issues`, `board_columns`                              |

Board issue 목록 필터 UI에 필요한 option과 count를 반환한다.

### Response Body

```json
{
  "success": true,
  "data": {
    "columns": [
      {
        "id": "1",
        "name": "Backlog",
        "normalizedName": "backlog",
        "count": 7
      }
    ],
    "states": [
      {
        "value": "open",
        "label": "Open",
        "count": 30
      },
      {
        "value": "closed",
        "label": "Closed",
        "count": 4
      }
    ],
    "assignees": [
      {
        "login": "kjh",
        "avatarUrl": "https://avatars.githubusercontent.com/u/123?v=4",
        "count": 8
      }
    ],
    "labels": [
      {
        "name": "auth",
        "color": "ededed",
        "count": 4
      }
    ],
    "milestones": [
      {
        "title": "v1.0",
        "count": 5
      }
    ]
  }
}
```

### Filter option 규칙

- `columns`는 `board_columns` 기준으로 계산한다.
- `states`는 `pilo_issues.state` 기준으로 계산한다.
- `assignees`, `labels`, `milestones`는 `pilo_issues.assignees`, `pilo_issues.labels`, `pilo_issues.milestone` JSONB 값을 기준으로 계산한다.
- PR 상태 필터는 Board API의 기본 filter option에 포함하지 않는다. PR 원본 목록과 상태 필터는 GitHub Integration API를 사용한다.

## 15. GitHub 수동 동기화 연동

Board API는 수동 동기화 endpoint를 정의하지 않는다. Board 화면에서 새 GitHub 데이터를 가져와야 하면 GitHub Integration API를 호출한다.

```http
POST /api/v1/workspaces/{workspaceId}/github/sync-runs
Content-Type: application/json
Idempotency-Key: <idempotency-key>
```

```json
{
  "target": "full",
  "repositoryId": "repo_123",
  "projectV2Id": "proj_123"
}
```

동기화 상태와 이력 조회도 GitHub Integration API를 사용한다.

```http
GET /api/v1/workspaces/{workspaceId}/github/sync-runs?repositoryId=repo_123&projectV2Id=proj_123
GET /api/v1/workspaces/{workspaceId}/github/sync-runs/{syncRunId}
```

Board hydrate는 GitHub sync 성공 이후 `hydrate_pilo_board_from_github(projectV2Id, repositoryId)`와 같은 서버 내부 로직으로 수행한다. API surface로 DB function 이름을 노출하지 않는다.

### Stale data 규칙

- GitHub sync가 `running`이어도 Board 조회 API는 마지막 성공 cache를 반환할 수 있다.
- GitHub sync가 `failed`이면 Board 조회 API는 마지막 성공 cache와 `sync.status = "failed"`를 함께 반환한다.
- `lastSyncedAt`은 board hydrate가 성공했을 때만 갱신한다.

## 16. 오류 코드

Board API는 GitHub Integration API의 오류 포맷과 code 이름을 따른다.

| HTTP Status | Code                             | 설명                                                            |
| ----------- | -------------------------------- | --------------------------------------------------------------- |
| 400         | `INVALID_REQUEST`                | request body 또는 query parameter가 유효하지 않음               |
| 401         | `UNAUTHORIZED`                   | 인증되지 않은 요청                                              |
| 403         | `FORBIDDEN`                      | workspace, board, repository, project 접근 권한 없음            |
| 403         | `GITHUB_PERMISSION_INSUFFICIENT` | GitHub App installation 권한 부족                               |
| 404         | `NOT_FOUND`                      | 요청한 board, column, issue, repository, project를 찾을 수 없음 |
| 409         | `CONFLICT`                       | idempotency key 충돌 또는 중복 요청 충돌                        |
| 422         | `UNPROCESSABLE_ENTITY`           | GitHub 동기화 상태상 Board hydrate를 처리할 수 없음             |
| 429         | `RATE_LIMITED`                   | GitHub API 또는 서버 rate limit 초과                            |
| 500         | `INTERNAL_ERROR`                 | 서버 내부 오류                                                  |
| 502         | `GITHUB_API_ERROR`               | GitHub Integration 동기화 또는 조회 실패                        |

### 예시

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Board not found."
  }
}
```

```json
{
  "success": false,
  "error": {
    "code": "UNPROCESSABLE_ENTITY",
    "message": "ProjectV2 status field has not been synced. Run GitHub sync first."
  }
}
```

## 17. 보안 규칙

- GitHub token, OAuth code, refresh token, installation token, GitHub App private key, webhook secret은 Board API 응답에 포함하지 않는다.
- Board API는 사용자 OAuth token을 사용하지 않는다. 사용자 OAuth token은 PR Review 제출에서만 필요하다.
- GitHub 원본 markdown은 raw markdown으로 반환할 수 있지만, 서버가 HTML로 렌더링한 값을 반환하지 않는다.
- 클라이언트가 markdown을 렌더링할 때 script, iframe, event handler, unsafe URL scheme을 제거해야 한다.
- `raw` JSONB 전체를 API 응답에 그대로 노출하지 않는다.
- 오류 메시지에는 GitHub secret, token, OAuth code, private key, webhook secret을 포함하지 않는다.

## 18. 제외 API

MVP Board API는 다음 endpoint를 제공하지 않는다.

```http
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues
DELETE /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/comments
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/labels
DELETE /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/labels/{label}
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/sync-runs
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/sync-runs
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/sync-runs/{syncRunId}
POST /api/v1/webhooks/github
```

Board write 기능을 추가하려면 GitHub mutation 처리, idempotency partial state, audit log, pending mutation queue, rollback 정책을 별도 명세로 먼저 정의해야 한다.

## 19. 화면별 호출 흐름

### 첫 연결

1. `GET /api/v1/workspaces/{workspaceId}/github/repositories`
2. `GET /api/v1/workspaces/{workspaceId}/github/projects-v2`
3. `GET /api/v1/workspaces/{workspaceId}/github/projects-v2/{projectV2Id}/status-options`
4. `POST /api/v1/workspaces/{workspaceId}/boards`
5. 필요한 경우 `POST /api/v1/workspaces/{workspaceId}/github/sync-runs`

### 보드 진입

1. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}`
2. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/columns`
3. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues`
4. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/filter-options`

### 검색과 필터

```http
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues?search=oauth
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues?state=open
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues?columnId=2&label=auth
GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues?assignee=kjh
```

### 이슈 상세 패널

1. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}`
2. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/pull-requests`

### 동기화 상태 확인

1. `GET /api/v1/workspaces/{workspaceId}/boards/{boardId}`
2. `GET /api/v1/workspaces/{workspaceId}/github/sync-runs?repositoryId={repositoryId}&projectV2Id={projectV2Id}`
3. `GET /api/v1/workspaces/{workspaceId}/github/sync-runs/{syncRunId}`

## 20. 구현 메모

- Board 생성은 클라이언트 입력으로 column을 만들지 않는다. 동기화된 GitHub ProjectV2 Status option에서 hydrate한다.
- Status option과 매칭되지 않는 issue는 `Unmapped` column으로 들어간다.
- Board card는 MVP에서 GitHub Issue만 대상으로 한다.
- `pilo_issues.position`은 GitHub Project item position을 사용한다. 값이 없으면 `0`을 사용한다.
- `board_columns.position`과 `pilo_issues.position`은 unique 제약이 있으므로 hydrate 중 충돌이 있으면 서버가 안정적인 tie-breaker를 적용해야 한다.
- issue-PR 관련 API는 first-class relation table이 없으므로 GitHub metadata 기반 파생 응답이다.
- Board API에서 필요한 PR 원본 상세가 있으면 GitHub Integration API의 PR endpoint를 사용한다.
