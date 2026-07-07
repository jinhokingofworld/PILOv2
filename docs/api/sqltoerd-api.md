# sqltoerd API

## 범위

sqltoerd API는 로그인한 Workspace 사용자가 MVP sqltoerd session을 Workspace에
저장하고 복원하기 위한 API다.

MVP에서는 active Workspace당 활성 sqltoerd session 1개만 지원한다. 이 문서에서는
`project`라는 용어를 사용하지 않고 `session`이라는 용어를 사용한다.

API가 담당하는 범위:

- active Workspace의 단일 sqltoerd session 조회
- sqltoerd session 생성
- sqltoerd session 자동 저장/수정
- sqltoerd session soft delete
- revision 기반 autosave conflict 감지
- 저장 payload validation

MVP API 범위가 아닌 것:

- SQL 실행
- SQL migration 적용
- server-side SQL parsing
- server-side ERD auto layout
- Local-only 저장
- JSON import/export
- PNG/SVG export
- theme 전환
- table/column inline edit
- Add column
- model-to-SQL 재생성
- BigQuery CTE lineage
- Prisma/DBML/Mermaid/PlantUML/SQLAlchemy/Sequelize source 저장
- Sticky note
- Group box
- Manual arrow
- URL 공유
- 실시간 협업
- 자유형 Canvas shape API와 sqltoerd object의 양방향 동기화
- Workspace별 여러 sqltoerd session 목록/최근 session 관리

sqltoerd는 자유형 Canvas의 하위 도구가 아니라 Workspace의 독립 기능이다. 화면은
tldraw 기반 surface를 사용할 수 있지만, 저장 API는 `canvas-api.md`의 freeform
canvas shape API를 재사용하지 않는다.

## 데이터 규칙

- 테이블: `sql_erd_sessions`
- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <pilo_access_token>`
- 모든 endpoint는 `workspaceId` path parameter를 기준으로 Workspace 접근 권한을 확인한다.
- 모든 endpoint는 `WorkspaceService.assertWorkspaceAccess(currentUserId, workspaceId)`를 먼저 통과해야 한다.
- `workspaceId`, `createdBy`, `updatedBy`, `tableCount`, `relationCount`는 request body로 받지 않는다.
- `createdBy`, `updatedBy`는 현재 로그인 사용자에서 온다.
- `tableCount`, `relationCount`는 서버가 `modelJson`에서 계산한다.
- SQL/source text는 실행하지 않고 plain text로만 저장한다.
- app-server는 SQL/source text를 DB query, migration, parser input, log message로 사용하지 않는다.
- 응답과 error message에는 SQL/source text 일부를 echo하지 않는다.
- 삭제는 `deletedAt`을 사용하는 soft delete로 처리한다.
- 자동 저장은 client에서 session당 2초에 1회 이하로 debounce/throttle한다.
- 같은 session을 여러 탭이나 기기에서 수정할 수 있으므로 `revision` 기반 conflict 처리를 사용한다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/sql-erd-session` | active Workspace의 활성 sqltoerd session 조회 |
| `POST` | `/workspaces/{workspaceId}/sql-erd-session` | sqltoerd session 생성 |
| `PATCH` | `/workspaces/{workspaceId}/sql-erd-session/{sessionId}` | sqltoerd session 자동 저장/수정 |
| `DELETE` | `/workspaces/{workspaceId}/sql-erd-session/{sessionId}` | sqltoerd session soft delete |

Endpoint 표는 공통 API 문서 규칙에 따라 `/api/v1` base path를 생략한다.

## 공통 타입

### Source Format

MVP write API는 아래 값만 허용한다.

```text
sql
```

### SQL Dialect

MVP write API는 아래 값을 허용한다.

```text
auto
postgresql
mysql
```

서버는 dialect 자동 감지를 수행하지 않는다. client가 감지한 값 또는 사용자가 선택한
값을 저장한다.

## Model JSON / Layout JSON Contract

`modelJson`과 `layoutJson`은 sqltoerd session API의 request/response payload이자
DB 저장 검증 기준이다. app-server는 SQL을 parsing하지 않고, client가 생성한
`modelJson`과 `layoutJson`의 schema와 제한값만 검증한다.

### modelJson v1

```ts
type SqltoerdModelJsonV1 = {
  version: 1;
  schema: {
    tables: ErdTable[];
    relations: ErdRelation[];
  };
};

type ErdTable = {
  id: string;
  name: string;
  schemaName: string | null;
  columns: ErdColumn[];
  constraints: ErdConstraint[];
  comment: string | null;
};

type ErdColumn = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  defaultValue: string | null;
  comment: string | null;
};

type ErdRelation = {
  id: string;
  kind: "foreign_key";
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
  constraintName: string | null;
};

type ErdConstraint = {
  id: string;
  kind: "primary_key" | "unique";
  columnIds: string[];
  name: string | null;
};
```

### layoutJson v1

```ts
type SqltoerdLayoutJsonV1 = {
  version: 1;
  tableLayouts: {
    tableId: string;
    x: number;
    y: number;
    width?: number;
  }[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
};
```

### Canonical Rules

- FK의 canonical source는 `modelJson.schema.relations`다.
- PK와 unique의 canonical source는 각 table의 `constraints`다.
- `ErdColumn.primaryKey`, `ErdColumn.foreignKey`, `ErdColumn.unique`는 UI 표시와
  빠른 조회를 위한 column-level summary 값이다.
- column-level summary 값은 parser/model 생성 시 canonical data에서 파생한다.
- summary 값과 canonical data가 충돌하면 canonical data를 우선한다.
- `nullable`은 column 속성으로 표현하며, `not_null`은 `constraints`에 별도로
  저장하지 않는다.

### Validation Rules

- `modelJson.version`과 `layoutJson.version`은 `1`만 허용한다.
- `schema.tables`와 `schema.relations`는 배열이어야 한다.
- table `id`는 `modelJson.schema.tables` 안에서 중복될 수 없다.
- 같은 table 안에서 column `id`는 중복될 수 없다.
- relation `id`는 `modelJson.schema.relations` 안에서 중복될 수 없다.
- relation의 `fromTableId`와 `toTableId`는 존재하는 table `id`를 참조해야 한다.
- relation의 `fromColumnIds`는 `fromTableId` table에 존재하는 column `id`만 참조해야 한다.
- relation의 `toColumnIds`는 `toTableId` table에 존재하는 column `id`만 참조해야 한다.
- `fromColumnIds`와 `toColumnIds`의 길이는 같아야 한다.
- composite FK는 `fromColumnIds[index] -> toColumnIds[index]` 순서로 매핑한다.
- constraint의 `columnIds`는 같은 table에 존재하는 column `id`만 참조해야 한다.
- `layoutJson.tableLayouts[].tableId`는 존재하는 table `id`를 참조해야 한다.
- `layoutJson.tableLayouts[].x`, `y`, `width`, `viewport.x`, `viewport.y`,
  `viewport.zoom`은 finite number여야 한다.
- `viewport.zoom`은 0보다 커야 한다.
- `id`, `name`, `schemaName`, `dataType`, `constraintName`, `comment`는 HTML로
  주입하지 않고 text로 렌더링해야 한다.
- table, column, relation id는 parser가 안정적으로 생성해야 한다. 같은 SQL source에서
  같은 entity는 가능한 한 같은 id를 가져야 한다.

### Count Rules

- `tableCount`는 `modelJson.schema.tables.length`에서 계산한다.
- `relationCount`는 `modelJson.schema.relations.length`에서 계산한다.
- client가 보낸 `tableCount`, `relationCount`는 사용하지 않는다.
- `layoutJson.tableLayouts.length`는 table 개수를 초과할 수 없다.

## Session Payload

```json
{
  "id": "session_uuid",
  "workspaceId": "workspace_uuid",
  "title": "Untitled ERD",
  "sourceFormat": "sql",
  "dialect": "postgresql",
  "sourceText": "CREATE TABLE users (...);",
  "modelJson": {
    "version": 1,
    "schema": {
      "tables": [],
      "relations": []
    }
  },
  "layoutJson": {
    "version": 1,
    "tableLayouts": []
  },
  "settingsJson": {},
  "tableCount": 6,
  "relationCount": 7,
  "revision": 3,
  "createdBy": "user_uuid",
  "updatedBy": "user_uuid",
  "createdAt": "2026-07-07T08:20:00.000Z",
  "updatedAt": "2026-07-07T08:25:00.000Z",
  "deletedAt": null
}
```

`settingsJson`은 MVP에서 선택값으로 받을 수 있으나, theme 전환이나 panel preference
저장은 MVP 수용 기준으로 삼지 않는다.

## 활성 Session 조회

```http
GET /api/v1/workspaces/{workspaceId}/sql-erd-session
```

Workspace에 활성 sqltoerd session이 있으면 session payload를 반환한다.

활성 session이 없으면 `404`가 아니라 `data: null`을 반환한다. 첫 사용자에게 빈
sqltoerd 화면을 보여주기 위한 동작이다.

응답:

```json
{
  "data": {
    "id": "session_uuid",
    "workspaceId": "workspace_uuid",
    "title": "Untitled ERD",
    "sourceFormat": "sql",
    "dialect": "postgresql",
    "sourceText": "CREATE TABLE users (...);",
    "modelJson": {
      "version": 1,
      "schema": {
        "tables": [],
        "relations": []
      }
    },
    "layoutJson": {
      "version": 1,
      "tableLayouts": []
    },
    "settingsJson": {},
    "tableCount": 6,
    "relationCount": 7,
    "revision": 3,
    "createdBy": "user_uuid",
    "updatedBy": "user_uuid",
    "createdAt": "2026-07-07T08:20:00.000Z",
    "updatedAt": "2026-07-07T08:25:00.000Z",
    "deletedAt": null
  }
}
```

활성 session이 없는 경우:

```json
{
  "data": null
}
```

## Session 생성

```http
POST /api/v1/workspaces/{workspaceId}/sql-erd-session
```

첫 Generate 성공 시 아직 session id가 없으면 client가 이 API를 호출한다.

MVP에서는 active Workspace당 활성 sqltoerd session 1개만 허용한다. 이미 활성
session이 있으면 `409 Conflict`를 반환한다.

Request:

```json
{
  "title": "Untitled ERD",
  "sourceFormat": "sql",
  "dialect": "postgresql",
  "sourceText": "CREATE TABLE users (...);",
  "modelJson": {
    "version": 1,
    "schema": {
      "tables": [],
      "relations": []
    }
  },
  "layoutJson": {
    "version": 1,
    "tableLayouts": []
  },
  "settingsJson": {}
}
```

생성 규칙:

- `title`이 없으면 `Untitled ERD`를 사용한다.
- `sourceFormat`은 `sql`만 허용한다.
- `dialect`가 없으면 `auto`를 사용한다.
- `sourceText`, `modelJson`, `layoutJson`은 Generate 성공 결과를 기준으로 보낸다.
- `settingsJson`이 없으면 `{}`를 사용한다.
- 서버는 `modelJson`에서 `tableCount`, `relationCount`를 계산한다.
- 서버는 `revision = 1`로 생성한다.
- 서버는 `createdBy`, `updatedBy`를 current user로 설정한다.

## Session 자동 저장

```http
PATCH /api/v1/workspaces/{workspaceId}/sql-erd-session/{sessionId}
```

Generate 성공, table 위치 변경, 저장 대상 설정 변경 시 client가 이 API로 자동
저장한다.

Request:

```json
{
  "baseRevision": 3,
  "title": "Commerce ERD",
  "sourceFormat": "sql",
  "dialect": "mysql",
  "sourceText": "CREATE TABLE users (...);",
  "modelJson": {
    "version": 1,
    "schema": {
      "tables": [],
      "relations": []
    }
  },
  "layoutJson": {
    "version": 1,
    "tableLayouts": []
  },
  "settingsJson": {}
}
```

수정 규칙:

- `baseRevision`은 필수다.
- 서버의 현재 `revision`과 `baseRevision`이 다르면 `409 Conflict`를 반환한다.
- 수정 가능한 필드는 `title`, `sourceFormat`, `dialect`, `sourceText`, `modelJson`, `layoutJson`, `settingsJson`이다.
- `workspaceId`와 `sessionId`가 함께 일치하는 활성 session만 수정한다.
- 삭제된 session은 수정할 수 없다.
- `modelJson`이 포함되면 서버는 `tableCount`, `relationCount`를 다시 계산한다.
- 수정 성공 시 `revision`을 1 증가시킨다.
- 수정 성공 시 `updatedBy`를 current user로 설정한다.

## Conflict 처리

`409 Conflict`가 발생하면 client는 서버 session을 자동으로 덮어쓰지 않는다.

권장 동작:

1. 자동 저장을 중단한다.
2. Source panel 또는 저장 상태 영역에 `conflict` 상태를 표시한다.
3. 최신 서버 session을 다시 조회한다.
4. 사용자에게 최신 서버 버전으로 복원할지, 현재 화면 상태를 다시 저장할지 선택하게 한다.

현재 화면 상태로 다시 저장하는 경우 client는 최신 서버 session의 `revision`을
새 `baseRevision`으로 사용해 `PATCH`를 재시도한다.

## Session 삭제

```http
DELETE /api/v1/workspaces/{workspaceId}/sql-erd-session/{sessionId}?baseRevision=4
```

MVP에서는 삭제 버튼을 UI에 노출하지 않을 수 있지만, 서버 API는 soft delete를
지원한다.

삭제 규칙:

- `baseRevision` query parameter는 필수다.
- 서버의 현재 `revision`과 `baseRevision`이 다르면 `409 Conflict`를 반환한다.
- `workspaceId`와 `sessionId`가 함께 일치하는 활성 session만 삭제한다.
- 삭제 성공 시 `deletedAt`을 현재 시각으로 설정한다.
- 삭제 성공 시 `revision`을 1 증가시킨다.

응답:

```json
{
  "data": {
    "id": "session_uuid",
    "deletedAt": "2026-07-07T08:30:00.000Z",
    "revision": 5
  }
}
```

## Validation

| 항목 | 제한 | 처리 |
| --- | ---: | --- |
| request body | UTF-8 기준 2 MiB | 초과 시 `413 Payload Too Large` |
| `title` | 1자 이상 120자 이하 | 위반 시 `400 Bad Request` |
| `sourceFormat` | `sql` | 위반 시 `400 Bad Request` |
| `dialect` | `auto`, `postgresql`, `mysql` | 위반 시 `400 Bad Request` |
| `sourceText` | UTF-8 기준 1 MiB | 초과 시 `413 Payload Too Large` |
| `modelJson` | JSON object | 위반 시 `400 Bad Request` |
| `layoutJson` | JSON object | 위반 시 `400 Bad Request` |
| `settingsJson` | JSON object | 위반 시 `400 Bad Request` |
| Table 개수 | 100개 | 초과 시 `400 Bad Request` |
| Column 총합 | 1,000개 | 초과 시 `400 Bad Request` |
| Table당 column 개수 | 200개 | 초과 시 `400 Bad Request` |
| Relation 개수 | 300개 | 초과 시 `400 Bad Request` |
| Identifier 길이 | 256자 | 초과 시 `400 Bad Request` |
| Column type 길이 | 512자 | 초과 시 `400 Bad Request` |
| JSON depth | 20단계 | 초과 시 `400 Bad Request` |

검증 규칙:

- 알 수 없는 top-level request field는 거부한다.
- `__proto__`, `prototype`, `constructor` key는 JSON payload에서 거부한다.
- JSON parse 실패, schema mismatch, limit 초과는 저장하지 않는다.
- validation 실패 응답에는 SQL 원문 일부를 포함하지 않는다.

## Error

| Status | 상황 |
| ---: | --- |
| `400 Bad Request` | validation 실패, 잘못된 enum, 잘못된 JSON 구조, `baseRevision` 누락 |
| `401 Unauthorized` | 인증 없음 또는 만료된 bearer token |
| `403 Forbidden` | Workspace 접근 권한 없음 |
| `404 Not Found` | Workspace 없음, 수정/삭제 대상 session 없음, 삭제된 session 수정/삭제 |
| `409 Conflict` | 활성 session 중복 생성, `revision` conflict |
| `413 Payload Too Large` | request body 또는 `sourceText` 크기 초과 |
| `429 Too Many Requests` | 과도한 autosave 요청 |
| `500 Internal Server Error` | 예상하지 못한 서버 오류 |

## 보안 규칙

- SQL은 절대 실행하지 않는다.
- SQL은 DB migration으로 적용하지 않는다.
- app-server는 SQL을 plain text로만 저장한다.
- app-server는 SQL 원문을 log에 남기지 않는다.
- API error response는 SQL 일부를 echo하지 않는다.
- DB 저장은 parameterized query만 사용한다.
- 화면 출력은 HTML 주입이 아니라 React text rendering/escape를 사용한다.
- 모든 조회/수정/삭제는 `workspaceId`와 `sessionId`를 함께 조건으로 검증한다.

## 향후 확장

아래 기능은 MVP 이후 별도 API 변경으로 추가한다.

- Local-only에서 Workspace 저장 전환 API
- Workspace별 여러 sqltoerd session 목록 API
- Workspace별 최근 session API
- JSON import/export API
- PNG/SVG export API
- BigQuery CTE lineage 저장
- inline edit/Add column에 따른 model-to-SQL 재생성 저장
