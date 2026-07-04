# Board API

## 범위

Board API는 GitHub Project Kanban MVP 화면을 위한 로컬 캐시 API를 제공한다.

- `boards`
- `board_columns`
- `pilo_issues`

Board API는 GitHub Integration이 동기화한 원본 데이터를 읽어 보드 화면용
캐시를 구성한다. MVP에서 Board는 읽기 전용이다. 이슈 생성/수정, ProjectV2
상태 변경, 드래그 앤 드롭 저장, 댓글, 라벨 변경, 삭제는 제외한다.

## 데이터 규칙

- Board는 하나의 `github_projects_v2`와 하나의 `github_repositories` 조합으로 hydrate한다.
- Column은 ProjectV2 Status field option에서 hydrate한다.
- Card는 ProjectV2 item 중 `ISSUE` content만 MVP 보드 카드로 사용한다.
- GitHub에는 `PULL_REQUEST` ProjectV2 item이 있을 수 있지만 MVP Board card는 issue card 기준이다.
- 상태 option에 매핑되지 않는 item은 로컬 `Unmapped` column에 배치한다.
- GitHub sync가 실행 중이거나 실패해도 Board API는 마지막 성공 cache를 반환할 수 있다.

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

## MVP 제외

```http
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
PATCH /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/status
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues
DELETE /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/comments
POST /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/labels
DELETE /api/v1/workspaces/{workspaceId}/boards/{boardId}/issues/{issueId}/labels/{label}
```
