# sqltoerd API

## 상태

- 구현 상태 기준: `origin/dev`의 `c67b4d8`(2026-07-13)
- 대상 단계: Post-MVP Phase 1 Workspace multi-session
- DB migration와 app-server: plural canonical API 구현 완료
- frontend: `origin/dev`의 session 목록·편집 화면은 plural API를 사용
- singular API: 기존 consumer를 위한 compatibility API로 유지
- 신규 consumer: plural endpoint만 사용
- rollout: 인증된 배포 환경의 plural CRUD/E2E 및 기존 singular consumer 전환 확인 후 singular deprecation을 별도 진행

## 범위

sqltoerd API는 로그인한 Workspace 사용자가 여러 sqltoerd session을 Workspace에
저장하고 목록에서 선택, 조회, 수정, 삭제하기 위한 API다. 이 문서에서는
`project`라는 용어를 사용하지 않고 `session`이라는 용어를 사용한다.

API가 담당하는 범위:

- Workspace의 활성 sqltoerd session 목록 조회
- 특정 sqltoerd session 상세 조회
- 여러 sqltoerd session 생성
- 특정 sqltoerd session 자동 저장/수정
- 특정 sqltoerd session soft delete
- 목록 cursor pagination과 최근 수정순 정렬
- singular endpoint의 전환기 호환
- revision 기반 autosave conflict 감지
- 저장 payload validation

이번 API 계약 범위가 아닌 것:

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
- 최근 열람 시각 또는 최근 session pointer 저장
- 삭제 session 복구와 version history

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
- 목록과 상세 조회는 `deletedAt IS NULL`인 session만 반환한다.
- session title은 같은 Workspace 안에서 중복될 수 있다.
- 목록 summary에는 `sourceText`, `modelJson`, `layoutJson`, `settingsJson`을
  포함하지 않는다.
- 목록/상세 조회 자체는 `updatedAt`이나 `revision`을 변경하지 않는다.
- 자동 저장은 client에서 session당 2초에 1회 이하로 debounce/throttle한다.
- 같은 session을 여러 탭이나 기기에서 수정할 수 있으므로 `revision` 기반 conflict 처리를 사용한다.

## API 목록

### Canonical plural API

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/sql-erd-sessions` | 활성 session 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/sql-erd-sessions` | session 생성 |
| `GET` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}` | session 상세 조회 |
| `PATCH` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}` | session 자동 저장/수정 |
| `DELETE` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}` | session soft delete |

### Singular compatibility API

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/sql-erd-session` | 가장 최근에 수정된 활성 session 조회 |
| `POST` | `/workspaces/{workspaceId}/sql-erd-session` | 활성 session이 없을 때만 legacy session 생성 |
| `PATCH` | `/workspaces/{workspaceId}/sql-erd-session/{sessionId}` | 기존 session 수정 |
| `DELETE` | `/workspaces/{workspaceId}/sql-erd-session/{sessionId}` | 기존 session soft delete |

Endpoint 표는 공통 API 문서 규칙에 따라 `/api/v1` base path를 생략한다.

## 공통 타입

### Source Format

현재 write API는 아래 값만 허용한다.

```text
sql
```

### SQL Dialect

현재 write API는 아래 값을 허용한다.

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
  annotations?: SqltoerdAnnotationsV1;
};

type SqltoerdAnnotationsV1 = {
  version: 1;
  links: SqltoerdAnnotationLink[];
};

type SqltoerdAnnotationLink =
  | SqltoerdTableAnnotationLink
  | SqltoerdColumnAnnotationLink;

type SqltoerdTableAnnotationLink = {
  id: string;
  kind: "table_link";
  fromTableId: string;
  toTableId: string;
  label: string;
};

type SqltoerdColumnAnnotationLink = {
  id: string;
  kind: "column_link";
  fromTableId: string;
  fromColumnId: string;
  toTableId: string;
  toColumnId: string;
  label: string;
};
```

`annotations`는 SQL에 반영되지 않는 Canvas 설명 관계 전용 영역이다. 실제 FK는
`modelJson.schema.relations`에만 저장하고 annotation link를 `ErdRelation`으로
취급하지 않는다.

#### Annotation Version과 하위 호환

- `layoutJson.annotations`는 optional이다.
- `annotations`가 없는 기존 `layoutJson v1`은 `{ version: 1, links: [] }`와 같은
  빈 annotation collection으로 해석한다.
- annotation schema의 호환되지 않는 변경은 `layoutJson.version`과 별개로
  `annotations.version`을 올리고 명시적인 migration을 추가한다.
- 현재 app-server는 `annotations.version: 1`만 저장한다.
- API mapper는 legacy payload에 `annotations`를 강제로 추가하지 않고 저장된 JSON을
  그대로 반환한다.

### Canonical Rules

- FK의 canonical source는 `modelJson.schema.relations`다.
- 사용자 설명 관계의 canonical source는 `layoutJson.annotations.links`다.
- 사용자 설명 관계는 SQL source, FK relation, table/relation count를 변경하지 않는다.
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
- `layoutJson.annotations.version`은 `1`만 허용한다.
- `layoutJson.annotations.links`는 최대 300개다.
- annotation `id`는 전체 link 배열에서 중복될 수 없다.
- annotation의 table/column endpoint는 `modelJson`에 존재하는 id를 참조해야 한다.
- annotation endpoint는 방향이 없는 관계로 취급하며 정방향과 역방향을 중복으로
  저장할 수 없다.
- SQL 직접 편집의 자동 parsing 결과로 기존 Column annotation endpoint에 실제 FK가 생긴 경우,
  API는 annotation을 자동 삭제하지 않고 일시적인 충돌 상태를 저장할 수 있다.
- 신규 Column annotation 생성 UI는 실제 FK와 같은 endpoint를 선택하지 못하게 한다.
- FK와 annotation이 충돌하면 실제 FK를 우선 표시하고, 후속 UI에서 사용자가 설명선
  제거 또는 label 보관을 선택하게 한다.
- annotation `label`은 빈 문자열을 허용하며 최대 200자다.
- `id`, `name`, `schemaName`, `dataType`, `constraintName`, `comment`는 HTML로
  주입하지 않고 text로 렌더링해야 한다.
- table, column, relation id는 parser가 안정적으로 생성해야 한다. 같은 SQL source에서
  같은 entity는 가능한 한 같은 id를 가져야 한다.

### Count Rules

- `tableCount`는 `modelJson.schema.tables.length`에서 계산한다.
- `relationCount`는 `modelJson.schema.relations.length`에서 계산한다.
- client가 보낸 `tableCount`, `relationCount`는 사용하지 않는다.
- `layoutJson.tableLayouts.length`는 table 개수를 초과할 수 없다.
- `layoutJson.annotations.links.length`는 table/relation count에 포함하지 않는다.

## Session Read Model

### Session Summary

목록 API는 SQL 원문과 큰 JSON payload를 제외한 summary만 반환한다.

```ts
type SqltoerdWorkspaceSessionSummary = {
  id: string;
  workspaceId: string;
  title: string;
  sourceFormat: "sql";
  dialect: "auto" | "postgresql" | "mysql";
  tableCount: number;
  relationCount: number;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`sourceText`, `modelJson`, `layoutJson`, `settingsJson`, `deletedAt`은
목록 summary에 포함하지 않는다.

### Session Detail Payload

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

`SqltoerdWorkspaceSessionDetail`은 summary field와 `sourceText`, `modelJson`,
`layoutJson`, `settingsJson`, `deletedAt`을 포함한다. 상세 API는 활성 session만
조회하므로 정상 응답의 `deletedAt`은 항상 `null`이다.

`settingsJson`은 선택값으로 받을 수 있으나, theme 전환이나 panel preference
저장은 이번 multi-session 계약의 수용 기준으로 삼지 않는다.

## Session 목록 조회

```http
GET /api/v1/workspaces/{workspaceId}/sql-erd-sessions?limit=20&cursor={cursor}
```

Workspace의 `deletedAt IS NULL`인 session을 summary로 조회한다. SQL 원문과
`modelJson`, `layoutJson`, `settingsJson`은 목록 응답에 포함하지 않는다.

### Query

| 이름 | 필수 | 기본값 | 제한 | 설명 |
| --- | --- | --- | --- | --- |
| `limit` | 아니요 | `20` | 1 이상 100 이하 정수 | 한 번에 반환할 최대 session 수 |
| `cursor` | 아니요 | 없음 | 2,048자 이하의 서버 발급 opaque string | 다음 page 시작 위치 |

정렬은 `updatedAt DESC, id DESC`로 고정한다. 이번 계약에서는 임의의 sort field나
ascending order query를 제공하지 않는다.

cursor는 마지막 item의 `updatedAt`과 `id`를 기준으로 서버가 발급한다. client는
cursor 내부 형식에 의존하거나 수정하지 않고 다음 요청에 그대로 전달한다. 형식이
잘못되었거나 현재 목록 정렬에 사용할 수 없는 cursor는 `400 Bad Request`다.
`limit`과 `cursor` 이외의 query field는 허용하지 않는다.

첫 page는 cursor 없이 요청한다. 응답 item이 없으면 `items`는 빈 배열이고
`nextCursor`는 `null`이다.

응답:

```json
{
  "data": {
    "items": [
      {
        "id": "session_uuid",
        "workspaceId": "workspace_uuid",
        "title": "Commerce ERD",
        "sourceFormat": "sql",
        "dialect": "postgresql",
        "tableCount": 6,
        "relationCount": 7,
        "revision": 3,
        "createdBy": "user_uuid",
        "updatedBy": "user_uuid",
        "createdAt": "2026-07-07T08:20:00.000Z",
        "updatedAt": "2026-07-07T08:25:00.000Z"
      }
    ],
    "nextCursor": "opaque_cursor_or_null"
  }
}
```

`nextCursor`는 다음 page가 있을 때만 string이고, 마지막 page에서는 `null`이다.
page 경계에서는 동일한 `updatedAt`을 가진 session도 `id`를 tie-breaker로 사용해
중복이나 누락 없이 이어서 조회한다.

## Session 상세 조회

```http
GET /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}
```

`workspaceId`와 `sessionId`가 함께 일치하고 `deletedAt IS NULL`인 session의
detail payload를 반환한다.

- session이 없거나 soft delete되었으면 `404 Not Found`다.
- 다른 Workspace의 session id를 전달해도 `404 Not Found`로 처리한다.
- 이 조회는 `updatedAt`, `revision`, 최근 열람 시각을 변경하지 않는다.

응답은 공통 success envelope의 `data`에
`SqltoerdWorkspaceSessionDetail`을 담는다.

## Compatibility: 최근 활성 Session 조회

```http
GET /api/v1/workspaces/{workspaceId}/sql-erd-session
```

Workspace에 활성 sqltoerd session이 있으면 `updatedAt DESC, id DESC` 기준 첫 번째
session의 detail payload를 반환한다.

활성 session이 없으면 `404`가 아니라 `data: null`을 반환한다. 첫 사용자에게 빈
sqltoerd 화면을 보여주던 기존 frontend 동작을 유지하기 위한 compatibility API다.

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
POST /api/v1/workspaces/{workspaceId}/sql-erd-sessions
```

사용자가 새 SQLtoERD canvas를 생성할 때 client가 호출한다. 한 Workspace에 여러
활성 session을 생성할 수 있고 title 중복을 허용한다.

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
- `sourceFormat`이 없으면 `sql`을 사용하며 현재는 `sql`만 허용한다.
- `dialect`가 없으면 `auto`를 사용한다.
- `sourceText`가 없으면 빈 문자열 `""`을 사용한다.
- `modelJson`과 `layoutJson`은 필수다.
- `sourceText`, `modelJson`, `layoutJson`은 자동 parsing에 성공한 동일 snapshot을 기준으로 보낸다.
- `settingsJson`이 없으면 `{}`를 사용한다.
- 서버는 `modelJson`에서 `tableCount`, `relationCount`를 계산한다.
- 서버는 `revision = 1`로 생성한다.
- 서버는 `createdBy`, `updatedBy`를 current user로 설정한다.
- 생성 성공 시 `201 Created`와 session detail payload를 반환한다.

## Session 자동 저장

```http
PATCH /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}
```

자동 parsing 성공, table 위치 변경, 저장 대상 설정 변경 시 client가 이 API로 자동
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
- `baseRevision` 외에 수정 가능한 field를 최소 하나 포함해야 한다.
- `baseRevision`만 보낸 request는 `400 Bad Request`다.
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
DELETE /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}?baseRevision=4
```

목록 또는 편집 화면에서 session을 삭제할 때 호출한다. 삭제는 soft delete로
처리하며 삭제된 session은 목록과 상세 조회에서 제외한다.

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

## Singular compatibility 정책

기존 singular consumer의 전환과 rollout 검증이 끝날 때까지 singular endpoint를 유지한다.

- singular endpoint의 deprecation을 시작하면 singular 응답에
  [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html#section-2.1)의 Structured
  Field Date 형식인 `Deprecation` header를 포함한다.
- `Deprecation`에는 boolean value를 사용하지 않는다. 형식 예시는
  `Deprecation: @1688169599`다.
- 실제 `Deprecation` timestamp는 deprecation 시작 시각을 기준으로 구현 PR에서
  확정한다. 현재는 deprecation을 시작하지 않았으므로 이 header를 보내지 않는다.
- `GET /sql-erd-session`은 `updatedAt DESC, id DESC` 기준 첫 번째 활성 session
  detail 또는 `data: null`을 반환한다.
- `POST /sql-erd-session`은 활성 session이 하나라도 있으면 기존 동작대로
  `409 Conflict`를 반환한다. 두 번째 session 생성에는 plural POST를 사용한다.
- singular PATCH/DELETE의 request, response, validation, revision 규칙은 같은
  `sessionId`를 사용하는 plural PATCH/DELETE와 동일하다.
- 신규 frontend와 다른 신규 consumer는 singular endpoint를 사용하지 않는다.
- 제거 예정일이 확정되지 않았으므로 이번 계약에서는 `Sunset` header를 보내지 않는다.
- frontend의 singular 호출 제거와 운영 전환 확인 후 별도 breaking-change Issue에서
  singular endpoint 제거를 진행한다.

## 적용 순서

1. 이 API 계약을 확정한다.
2. `sql_erd_sessions`의 active Workspace unique index를 제거하는 DB migration을
   별도 Issue에서 추가한다. (완료)
3. app-server에 plural endpoint와 singular compatibility 동작을 함께 구현한다. (완료)
4. frontend 목록/상세 route를 plural API로 전환한다. (`origin/dev` 완료, 배포 E2E 확인 필요)
5. 운영 consumer 전환을 확인한 뒤 singular endpoint 제거 여부를 결정한다.

plural endpoint는 현재 사용할 수 있으며, 신규 consumer는 plural endpoint만 사용한다.

## Validation

| 항목 | 제한 | 처리 |
| --- | ---: | --- |
| 목록 `limit` | 기본 20, 최소 1, 최대 100 | 위반 시 `400 Bad Request` |
| 목록 `cursor` | 2,048자 이하의 서버 발급 opaque string | 길이/해석/검증 실패 시 `400 Bad Request` |
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
| Annotation link 개수 | 300개 | 초과 시 `400 Bad Request` |
| Annotation label | 200자 이하 | 초과 시 `400 Bad Request` |
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
| `400 Bad Request` | validation 실패, 잘못된 enum/JSON/cursor 구조, `baseRevision` 누락, PATCH 수정 field 누락 |
| `401 Unauthorized` | 인증 없음 또는 만료된 bearer token |
| `403 Forbidden` | Workspace 접근 권한 없음 |
| `404 Not Found` | Workspace 없음, 상세/수정/삭제 대상 session 없음, 삭제된 session 접근 |
| `409 Conflict` | `revision` conflict, singular 중복 생성 |
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
- 목록 조회와 singular GET은 current user의 Workspace 접근 권한과 `workspaceId`를
  검증한다.
- 상세 조회, PATCH, DELETE는 Workspace 접근 권한을 확인한 뒤 `workspaceId`,
  `sessionId`, `deletedAt IS NULL`을 함께 조건으로 검증한다.
- POST는 Workspace 접근 권한을 확인하고 request body가 아닌 path의 `workspaceId`와
  current user를 저장 기준으로 사용한다.

## 향후 확장

아래 기능은 후속 API 변경으로 추가한다.

- Local-only에서 Workspace 저장 전환 API
- 최근 열람 시각 또는 최근 session pointer API
- 삭제 session 복구와 version history
- JSON import/export API
- PNG/SVG export API
- BigQuery CTE lineage 저장
- inline edit/Add column에 따른 model-to-SQL 재생성 저장
