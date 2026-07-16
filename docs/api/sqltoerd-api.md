# sqltoerd API

## 상태

- 구현 상태 기준: 2026-07-16
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
- public session API에서의 server-side SQL parsing
- Local-only 저장
- JSON import/export
- PNG/SVG export
- theme 전환
- table/column inline edit
- Add column
- model-to-SQL 재생성
- BigQuery CTE lineage
- Prisma/DBML/Mermaid/PlantUML/SQLAlchemy/Sequelize source 저장
- Manual arrow
- URL 공유
- 자유형 Canvas shape API와 sqltoerd object의 양방향 동기화
- 최근 열람 시각 또는 최근 session pointer 저장
- 삭제 session 복구와 version history

sqltoerd는 자유형 Canvas의 하위 도구가 아니라 Workspace의 독립 기능이다. 화면은
tldraw 기반 surface를 사용할 수 있지만, 저장 API는 `canvas-api.md`의 freeform
canvas shape API를 재사용하지 않는다.

## 내부 Agent schema 생성 계약

이 절은 public HTTP endpoint가 아니라 Agent tool adapter가 호출할 SQLtoERD domain
mutation 계약이다. AI Worker는 임의 DDL 문자열 대신 `SqlErdSchemaSpecV1`을 만들고,
App Server가 검증한 뒤 server-side DDL·modelJson·layoutJson 생성 과정을 결정적으로
수행한다. 생성한 DDL은 실제 DB에 실행하지 않는다.

```ts
type SqlErdSchemaSpecV1 = {
  version: 1;
  title: string;
  requestedDialect: "postgresql" | "mysql" | "sqlite" | null;
  tables: SqlErdSchemaTableSpec[];
  relations: SqlErdSchemaRelationSpec[];
  unsupportedFeatures: Array<
    | "views"
    | "triggers"
    | "stored_procedures"
    | "check_constraints"
    | "indexes"
    | "enums"
    | "partitions"
    | "permissions_rls"
    | "database_execution"
    | "comments"
    | "raw_default_expressions"
  >;
};

type SqlErdSchemaTableSpec = {
  key: string;
  name: string;
  schemaName: string | null;
  columns: SqlErdSchemaColumnSpec[];
  primaryKey: SqlErdSchemaKeyConstraintSpec | null;
  uniqueConstraints: SqlErdSchemaKeyConstraintSpec[];
};

type SqlErdSchemaColumnSpec = {
  key: string;
  name: string;
  dataType: {
    kind:
      | "boolean"
      | "smallint"
      | "integer"
      | "bigint"
      | "decimal"
      | "real"
      | "double"
      | "char"
      | "varchar"
      | "text"
      | "date"
      | "time"
      | "timestamp"
      | "timestamp_tz"
      | "uuid"
      | "json"
      | "binary";
    length: number | null;
    precision: number | null;
    scale: number | null;
  };
  nullable: boolean;
  autoIncrement: boolean;
  defaultValue:
    | { kind: "literal"; value: string | number | boolean | null }
    | { kind: "current_date"; value: null }
    | { kind: "current_timestamp"; value: null }
    | null;
};

type SqlErdSchemaKeyConstraintSpec = {
  name: string | null;
  columnKeys: string[];
};

type SqlErdSchemaRelationSpec = {
  key: string;
  name: string | null;
  fromTableKey: string;
  fromColumnKeys: string[];
  toTableKey: string;
  toColumnKeys: string[];
};
```

모든 object는 명시되지 않은 필드를 거부한다. `key`는 tool-local 참조 값이며 DB에는
저장하지 않는다. table key와 relation key는 spec 전체에서 각각 유일하고, column
key는 table 안에서 유일해야 한다. relation의 table/column 참조와 양쪽 column 수는
정확히 일치해야 한다. relation의 `toColumnKeys`는 대상 table의 primary key 또는
하나의 unique constraint `columnKeys`와 순서를 포함해 정확히 일치해야 한다.

제한은 다음과 같다.

- 직렬화한 schemaSpec: UTF-8 최대 48 KiB
- title: 1~120자, identifier: 1~256자
- tables: 1~100개
- columns: table당 1~200개, 전체 최대 1,000개
- relations: 최대 300개
- 생성된 sourceText, modelJson, layoutJson: 각각 UTF-8 최대 1 MiB
- source snapshot 세 구성요소 합계: 최대 3 MiB

`length`는 `char`, `varchar`, `binary`에서만 1~65,535로 허용한다. `precision`과
`scale`은 `decimal`에서만 각각 1~1,000, 0~precision으로 허용한다. 자동 증가는
단일 정수 PK column에서만 허용하고 PK column은 nullable일 수 없다. raw SQL type과
raw default expression은 받지 않으며, integer literal을 포함한 모든 literal은 논리
type과 일치해야 한다. SQLite는 `schemaName`을 허용하지 않는다.

동일한 정규화 spec과 dialect는 byte-stable DDL, model identity와 초기 layout을
생성해야 한다. table/column/constraint ID와 FK legacy/v2 hash ID는 frontend parser의
stable identity 규칙을 그대로 사용한다. 초기 layout은 frontend와 같은 Dagre 3.x
설정과 table card 크기 계산을 사용한다. `unsupportedFeatures`와
`timestamp_tz`의 MySQL/SQLite downgrade는 bounded warning으로 반환한다.
PostgreSQL과 MySQL DDL은 입력 table 순서나 순환 참조와 무관하게 실행할 수 있도록
모든 `CREATE TABLE` 뒤에 FK `ALTER TABLE` 문을 생성한다. SQLite는 FK를 각
`CREATE TABLE` 안에 inline으로 생성한다.

### Agent 신규 세션 mutation

- Workspace 접근 권한을 먼저 확인한다.
- dialect 미지정은 PostgreSQL로 생성한다.
- `sql_erd_agent_session_creations`가
  `(workspaceId, actorUserId, agentRunId)`를 멱등성 key로 저장한다.
- 같은 key와 같은 정규화 schema fingerprint는 원래 session을 반환한다.
- 같은 key를 다른 schema에 재사용하면 `409 CONFLICT`로 거부한다.
- session과 ledger row는 Workspace row lock 아래 한 DB transaction에서 생성한다.
- 새 session의 write protocol은 `SQL_ERD_OPERATIONS_V1_ENABLED` 정책을 따른다.

### Agent 현재 세션 교체 mutation

- `operations_v1` session에서만 허용하며 snapshot session은
  `409 SQL_ERD_WRITE_PROTOCOL_MISMATCH`로 거부한다.
- session row를 잠근 뒤 활성 source lock이 하나라도 있으면 교체를 거부한다. Agent가
  사용자 lease를 가장하거나 별도 공개 lease endpoint를 사용하지 않는다.
- PostgreSQL/MySQL/SQLite session은 기존 dialect를 유지한다. schemaSpec에 다른
  dialect가 명시되면 `409 CONFLICT`로 거부한다. `auto` session은 요청 dialect로
  렌더링하고 요청이 없으면 PostgreSQL로 렌더링하되 저장 dialect는 `auto`를 유지한다.
- schemaSpec title은 무시하고 기존 session title을 유지한다.
- 최신 layout에 `rebaseSqlErdSourceLayout`을 적용해 동일 stable ID table 위치와
  유효 annotation을 보존하고, 사라진 참조를 정리하며 새 table만 배치한다.
- agentRunId를 deterministic `clientOperationId`로 사용한다. 같은 실행의 재시도는
  원래 결과를 반환하고 다른 schema 재사용은 `409 CONFLICT`로 거부한다.
- session update, immutable snapshot, `source_snapshot` operation과 outbox insert를
  한 transaction에서 commit한다. operation은 일반 source publish와 같은 `opSeq`
  순서 및 realtime/catch-up 경로를 사용한다.

## Realtime Presence (Phase 1)

SQLtoERD 편집 화면은 REST session API와 별도로 Socket.IO presence room을 사용할 수
있다. 이 단계는 다른 사용자의 현재 위치와 선택 상태만 보여 주며, session의
`sourceText`, `modelJson`, `layoutJson`을 저장하거나 동기화하지 않는다.

- room name: `workspace:{workspaceId}:sql-erd:{sessionId}`
- 인증: REST API와 같은 bearer session token을 Socket.IO handshake에 전달한다.
- 접근: `sql_erd_sessions.workspace_id`와 일치하고 `deleted_at IS NULL`인 session에
  대해, 해당 Workspace의 활성 `workspace_members`만 room에 입장할 수 있다.
- presence 상태는 연결된 socket의 메모리에만 유지한다. Redis Socket.IO adapter가
  설정된 multi-instance 환경에서는 room socket snapshot을 adapter로 수집한다.
  새로고침·재접속·server 재시작 뒤 복원하지 않으며 DB에 저장하지 않는다.
- `latestOpSeq`는 마지막 저장 operation 순번이다. 현재 `snapshot` session은 operation write를 허용하지 않아 일반적으로 `0`이고, `operations_v1` session은 마지막 저장 operation의 `opSeq`를 반환한다. `sql-erd:joined` reads `latestOpSeq` from `sql_erd_sessions.latest_op_seq` in the database for each authorized join; it is not calculated from in-memory presence or a client-supplied sequence.

### Client events

```ts
"sql-erd:join" = {
  workspaceId: string;
  sessionId: string;
};

"sql-erd:leave" = {
  workspaceId: string;
  sessionId: string;
};

"sql-erd:presence:update" = {
  workspaceId: string;
  sessionId: string;
  cursor: { x: number; y: number } | null;
  selectedObjects: SqltoerdPresenceSelectedObject[]; // max 100
  tool: "select" | "note" | "frame" | "text" | "draw" | "eraser";
  editingMode: "draw" | "move" | "resize" | "relation" | "sql" | null;
  sentAt: string; // ISO 8601
};

type SqltoerdPresenceSelectedObject = {
  type: "table" | "relation" | "annotation" | "note" | "frame" | "text" | "stroke";
  id: string;
};
```

Client는 cursor를 tldraw page 좌표로 전송한다. pointer 이동은 `socket.volatile.emit()`
으로 최대 80ms마다 전송하며, 마지막 전송 좌표에서 1.5 page 단위 이상 움직였을 때만
전송한다. 5초 heartbeat와 15초 stale timeout을 사용하며, canvas를 벗어나면
`cursor: null`을 전송한다.

### Server events

```ts
"sql-erd:joined" = {
  workspaceId: string;
  sessionId: string;
  latestOpSeq: number;
  presence: SqltoerdPresenceState[];
};

"sql-erd:presence:update" = SqltoerdPresenceState;

"sql-erd:presence:leave" = {
  workspaceId: string;
  sessionId: string;
  userId: string;
};

"sql-erd:operation" = SqltoerdLayoutPatchOperation;

"sql-erd:error" = {
  code: "invalid_payload" | "forbidden" | "room_not_joined";
  message: string;
};

type SqltoerdPresenceState = {
  workspaceId: string;
  sessionId: string;
  userId: string;
  displayName: string;
  cursor: { x: number; y: number } | null;
  selectedObjects: SqltoerdPresenceSelectedObject[];
  tool: "select" | "note" | "frame" | "text" | "draw" | "eraser";
  editingMode: "draw" | "move" | "resize" | "relation" | "sql" | null;
  sentAt: string;
  updatedAt: string;
};

type SqltoerdLayoutPatchOperation = {
  id: string;
  workspaceId: string;
  sessionId: string;
  actorUserId: string;
  type: "layout_patch";
  opSeq: number;
  clientOperationId: string;
  baseRevision: number;
  appliedOnRevision: number;
  resultRevision: number;
  rebased: boolean;
  patch: SqltoerdLayoutPatch;
  createdAt: string;
};
```

`userId`와 `displayName`은 Socket.IO handshake payload를 신뢰하지 않는다. realtime
server는 bearer session 검증 뒤 `users`와 `user_settings`에서 읽은 사용자 정보를
사용해 채운다. 수신자는 page 좌표를 자신의 viewport 기준 screen 좌표로 변환하며,
cursor는 requestAnimationFrame 보간으로 표시할 수 있다. `editingMode: "sql"`은
SQL source panel이 열린 상태를 뜻한다.

같은 사용자가 같은 session을 여러 탭에서 열어도 room은 사용자당 하나의 presence만
노출한다. 탭 하나가 leave·disconnect되면 남은 탭의 최신 presence를 `presence:update`
로 전환 전송하며, 마지막 탭이 사라질 때만 `presence:leave`를 전송한다.

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
- Soft delete is write-protocol-independent and cleans up any source-writer lease in the same transaction.
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
| `GET` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/operations` | 저장된 operation catch-up 조회 |
| `POST` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/operations` | layout patch operation 저장 |
| `PATCH` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}` | session 자동 저장/수정 |
| `PATCH` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/metadata` | session title metadata 수정 |
| `DELETE` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}` | session soft delete |

| `GET` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-snapshots` | immutable source snapshot batch read |
| `POST` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-snapshots` | source publish |
| `POST` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-lock` | acquire source writer lease |
| `PATCH` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-lock` | renew source writer lease |
| `DELETE` | `/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-lock` | release source writer lease |

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
sqlite
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
  notes?: SqltoerdCanvasNote[];
  frames?: SqltoerdCanvasFrame[];
  texts?: SqltoerdCanvasText[];
  strokes?: SqltoerdCanvasStroke[];
};

type SqltoerdCanvasNote = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

type SqltoerdCanvasText = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: "slate" | "blue" | "green" | "amber" | "rose";
};

type SqltoerdCanvasFrame = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  color: "slate" | "blue" | "green" | "amber" | "rose";
  isLocked: boolean;
};

type SqltoerdCanvasStroke = {
  id: string;
  points: { x: number; y: number }[];
  color: "slate" | "blue" | "green" | "amber" | "rose";
  size: number;
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

`annotations`는 SQL에 반영되지 않는 Canvas annotation 영역이다. 실제 FK는
`modelJson.schema.relations`에만 저장하고 annotation link를 `ErdRelation`으로
취급하지 않는다. `notes`는 Sticky note, `frames`는 Group box, `texts`는 독립 텍스트,
`strokes`는 자유 그리기 선을 위한 시각 요소다.

`annotations.notes`, `annotations.frames`, `annotations.texts`,
`annotations.strokes`는 SQL, FK, table/relation count를 바꾸지 않는 독립적인 시각
annotation이다. 각각 최대 100개이며 id는 `links`, `notes`, `frames`, `texts`,
`strokes` 전체에서 중복될 수 없다. 좌표와 크기는 finite number이고 크기는 0보다 커야
한다. note/text 본문은 최대 2,000자, frame title은 최대 200자이며 frame/text/stroke
color는 `slate`, `blue`, `green`, `amber`, `rose`만 허용한다. stroke는 2개 이상 500개
이하의 finite `{ x, y }` point와 0보다 크고 32 이하인 `size`를 가진다.

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
- annotation `id`는 `links`, `notes`, `frames`, `texts`, `strokes` 전체에서 중복될 수 없다.
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
  dialect: "auto" | "postgresql" | "mysql" | "sqlite";
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
  "writeProtocol": "snapshot",
  "latestOpSeq": 0,
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

### `settingsJson.sqltoerdRelationNotes`

설명 관계(`column_link`)를 실제 FK로 전환할 때 사용자가 기존 label 보관을
선택하면, label은 SQL 문이나 FK constraint name이 아니라 아래 relation note map에
저장한다.

```ts
type SqltoerdRelationNotes = Record<string, string>;

type SqltoerdSettingsJson = {
  sqltoerdRelationNotes?: SqltoerdRelationNotes;
  [key: string]: unknown;
};
```

- key는 현재 `modelJson.schema.relations`에 존재하는 stable FK relation id다.
- value는 전환 전 설명 관계 label이며, 기존 annotation label 제한(최대 200자)을
  따른다.
- relation note는 FK SQL, relation count, FK cardinality를 변경하지 않는다.
- 사용자가 label 폐기를 선택하거나 대상 FK가 없어지면 relation note를 저장하거나
  표시하지 않는다.

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

### New session write protocol

The App Server explicitly writes `writeProtocol` when creating every new
session. `SQL_ERD_OPERATIONS_V1_ENABLED=true` creates a new session with
`operations_v1`; when the flag is absent or any other value, the explicit value
is `snapshot`. The database column default remains `snapshot` as a migration
safety backstop; it does not select or migrate a protocol for an existing row.

This capability flag is not a production cutover. Production enablement,
existing-session migration, and rollout verification remain operational
follow-up work.

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

## Plural session metadata

```http
PATCH /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/metadata
```

This endpoint is for a session title change without sending a full snapshot.
The plural metadata PATCH accepts only `baseRevision` and `title`; unknown
fields, including source, model, layout, settings, and write-protocol fields,
return `400 Bad Request`.

```json
{
  "baseRevision": 3,
  "title": "Commerce ERD"
}
```

`baseRevision` is required and must equal the active session revision. On
success the server changes only `title`, increments `revision`, updates
`updatedBy`, and returns the session detail payload. This metadata write is
independent of `writeProtocol`.

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
- The plural and singular delete endpoints are write-protocol-independent. They
  clear every source-writer lease for the session in the same transaction before
  setting `deletedAt`; a source lock cannot keep a session from being deleted.

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
| `dialect` | `auto`, `postgresql`, `mysql`, `sqlite` | 위반 시 `400 Bad Request` |
| `sourceText` | UTF-8 기준 1 MiB | 초과 시 `413 Payload Too Large` |
| `modelJson` | JSON object | 위반 시 `400 Bad Request` |
| `layoutJson` | JSON object | 위반 시 `400 Bad Request` |
| `settingsJson` | JSON object | 위반 시 `400 Bad Request` |
| Table 개수 | 100개 | 초과 시 `400 Bad Request` |
| Column 총합 | 1,000개 | 초과 시 `400 Bad Request` |
| Table당 column 개수 | 200개 | 초과 시 `400 Bad Request` |
| Relation 개수 | 300개 | 초과 시 `400 Bad Request` |
| Annotation link 개수 | 300개 | 초과 시 `400 Bad Request` |
| Annotation note/frame/text 개수 | 종류별 100개 | 초과 시 `400 Bad Request` |
| Annotation label | 200자 이하 | 초과 시 `400 Bad Request` |
| Annotation note/text 본문 | 2,000자 이하 | 초과 시 `400 Bad Request` |
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
## Realtime durable operation protocol

세션의 `writeProtocol`은 durable write 경로를 구분한다. 기존 세션은 `snapshot`으로 전체 `PATCH` autosave를 유지한다. `operations_v1`으로 활성화된 세션은 layout·annotation 변경을 operation API로만 저장하며 legacy `PATCH`는 `409 SQL_ERD_WRITE_PROTOCOL_MISMATCH`로 거부된다. 두 경로를 같은 세션에서 동시에 허용하지 않는다.

```http
POST /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/operations
```

요청은 `clientOperationId`, `baseRevision`, `type: "layout_patch"`, `patch`를 포함한다. patch는 collection별 `upsert`와 `deleteIds`를 명확히 구분하며, `tableLayouts`, annotation의 `links/notes/frames/texts/strokes`, viewport set/delete를 지원한다. 서버는 session row lock 아래 최신 layout에 stale patch를 병합하고 revision, op sequence, operation log, outbox intent를 한 transaction으로 기록한다. 같은 `(sessionId, actorUserId, clientOperationId)` 재시도는 기존 operation을 반환한다.

```http
GET /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/operations?afterSeq=42&limit=100
```

Catch-up 응답은 순번 오름차순 `items`, `latestOpSeq`, `nextAfterSeq`를 반환한다. Redis/Socket.IO delivery는 at-least-once이므로 클라이언트는 `opSeq`와 operation id로 중복 제거하고, sequence gap은 catch-up으로 복구한다. outbox publisher는 claim token을 사용하며 publishing row는 60초 후 reclaim되어 publish 실패가 영구 누락으로 남지 않는다.

실제 `operations_v1` 전환은 operation frontend, pending autosave 완료, source lock 충돌 없음, baseline/sequence 생성, 오래된 탭의 reload/read-only 안내가 준비된 후 별도 API에서 수행한다. source snapshot/lease와 metadata writer는 이 단계의 범위가 아니다.
### Durable operation API contract

`GET /workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/operations` and `POST /workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/operations` are canonical plural endpoints. `GET` is a write-protocol-independent read-only catch-up endpoint: it returns saved operation log entries. Because `snapshot` sessions currently reject operation writes, they normally return `items: []` and `latestOpSeq: 0`; this is not a permanent empty-history guarantee.

Session detail contains `writeProtocol: "snapshot" | "operations_v1"` and `latestOpSeq: number`. In `operations_v1`, `latestOpSeq` is the last committed operation sequence.

```ts
type PatchCollection<T> = { upsert?: T[]; deleteIds?: string[] };
type SqltoerdLayoutPatch = {
  tableLayouts?: PatchCollection<{ tableId: string; x: number; y: number; width?: number }>;
  annotations?: {
    links?: PatchCollection<SqltoerdAnnotationLink>;
    notes?: PatchCollection<SqltoerdCanvasNote>;
    frames?: PatchCollection<SqltoerdCanvasFrame>;
    texts?: PatchCollection<SqltoerdCanvasText>;
    strokes?: PatchCollection<SqltoerdCanvasStroke>;
  };
  viewport?: { action: "set"; value: { x: number; y: number; zoom: number } } | { action: "delete" };
};
type SqltoerdLayoutPatchOperationRequest = {
  clientOperationId: string; // 1..128; unique per (sessionId, actorUserId, clientOperationId)
  baseRevision: number; // positive integer
  type: "layout_patch";
  patch: SqltoerdLayoutPatch;
};

type SqltoerdOperationWriteResponse = {
  operation: SqltoerdLayoutPatchOperation;
  layoutJson: SqltoerdLayoutJsonV1;
  revision: number;
  latestOpSeq: number;
};

type SqltoerdOperationCatchupResponse = {
  items: SqltoerdLayoutPatchOperation[];
  latestOpSeq: number;
  nextAfterSeq: number | null;
};
```

`POST` request body is `SqltoerdLayoutPatchOperationRequest` and returns `SqltoerdOperationWriteResponse`. Its idempotency key is the tuple `(sessionId, actorUserId, clientOperationId)`. `GET` accepts `afterSeq` (non-negative integer, default `0`) and `limit` (integer `1..100`, default `100`) and returns `SqltoerdOperationCatchupResponse` in ascending sequence order.

An `operations_v1` session rejects legacy durable `PATCH` with `409` and `error.code: "SQL_ERD_WRITE_PROTOCOL_MISMATCH"`. A future `baseRevision` returns `409` with `error.code: "CONFLICT"`.

On `SQL_ERD_WRITE_PROTOCOL_MISMATCH`, the client pauses autosave and persistence, disables retry, and shows a reload/read-only 안내. A session reload is required before persistence resumes. It does not retry the stale payload or silently switch protocols. Reload fetches the current session detail and uses its returned `writeProtocol`; until that succeeds, pending source/layout changes stay unsaved in the old tab.

### Cutover monitoring

With `SQL_ERD_OPERATIONS_V1_ENABLED=true`, the App Server writes an error-level
JSON log with event `SQL_ERD_OPERATIONS_V1_SNAPSHOT_CREATION_DETECTED` if its
own create path receives a protocol other than `operations_v1`. In addition,
the database `AFTER INSERT` trigger records every `sql_erd_sessions` creation in
`sql_erd_session_creation_audit`, including direct SQL and omitted-protocol
paths that use the database default. Alert on the App Server event and run this
cutover query (set `:cutover_started_at` to the flag-on time):

```sql
SELECT session_id, workspace_id, session_created_at, observed_at, write_protocol
FROM sql_erd_session_creation_audit
WHERE session_created_at >= :cutover_started_at
  AND write_protocol = 'snapshot'
ORDER BY session_created_at DESC;
```

`sql-erd:operation` carries the `operation` object itself, not the HTTP write-response envelope. The App Server commits the session, operation, and outbox record in one DB transaction; the outbox then broadcasts the saved operation through Redis/Socket.IO. Delivery is at-least-once, so clients deduplicate by `id` or `opSeq` and use GET catch-up when a sequence gap is detected.

## Source snapshot and source writer lease

Source-lock mutation and source publish endpoints reject a `snapshot` session
with `409 SQL_ERD_WRITE_PROTOCOL_MISMATCH`; until an operations protocol is
selected for that session, legacy PATCH remains its source writer. Source
snapshot batch read is protocol-independent because it is a read-only catch-up
endpoint. Once a session is `operations_v1`, legacy durable session PATCH is
rejected with the same code. Session DELETE remains protocol-independent and
atomically removes its source-writer lease as part of the soft delete.

### Lease

```http
POST /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-lock
PATCH /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-lock
DELETE /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-lock
```

Each request body is `{ "leaseId": "uuid" }`. Acquire locks the session row
before inspecting the lease and grants a 30-second lease. Retrying acquire with
the same authenticated user and `leaseId` returns the existing lease. Renew and
publish require the same unexpired owner/lease pair. Release is idempotent only
for a missing matching lease; any active mismatch returns generic `409 CONFLICT`
without revealing the holder.

```ts
type SqltoerdSourceLock = {
  leaseId: string;
  sourceBaseRevision: number;
  expiresAt: string;
};
```

### Publish

```http
POST /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-snapshots
```

The route accepts up to 4 MiB so the request envelope fits, while its persisted
immutable snapshot remains constrained to 3 MiB total:

```ts
type SqltoerdSourcePublishRequest = {
  baseRevision: number;
  clientOperationId: string; // unique: (sessionId, actorUserId, clientOperationId)
  leaseId: string;
  sourceFormat: "sql";
  dialect: "auto" | "postgresql" | "mysql" | "sqlite";
  sourceText: string; // UTF-8 <= 1 MiB
  modelJson: SqltoerdModelJsonV1; // serialized UTF-8 <= 1 MiB
};
```

The client must send `modelJson` produced from the same parse result as
`sourceText`. The server validates JSON schema, size and the rebased layout, but
does not parse SQL or prove source/model semantic equivalence. It rebases the
latest server layout under a session row lock, stores source/model/rebased-layout
in an immutable row, updates the session, records a `source_snapshot` operation,
and inserts its outbox row in one DB transaction. The snapshot's layout is the
canonical replay result; the operation contains only `sourceSnapshotId` and no
source/model/layout body.

`clientOperationId` retries use a SHA-256 fingerprint of normalized source
input. The same key and fingerprint returns the original operation, snapshot,
revision and rebase summary. Reusing the key with a different source/model input
returns `409 CONFLICT`.

```ts
type SqltoerdSourceSnapshotOperation = {
  id: string;
  workspaceId: string;
  sessionId: string;
  actorUserId: string;
  type: "source_snapshot";
  opSeq: number;
  clientOperationId: string;
  baseRevision: number;
  appliedOnRevision: number;
  resultRevision: number;
  rebased: boolean;
  sourceSnapshotId: string;
  createdAt: string;
};
```

`sql-erd:operation` is a union of the existing `layout_patch` event and this
`source_snapshot` event. The latter carries exactly the type above.

### Batch read and replay

```http
GET /api/v1/workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-snapshots?ids={uuid},{uuid}
```

`ids` is required, deduplicated, limited to 1..3 UUIDs and a 2,048-character
query. The response preserves normalized request order. Every ID must belong to
the stated workspace/session; otherwise the request returns `404` rather than a
partial response. Each snapshot has source/model/layout components of at most
1 MiB and the persisted total is at most 3 MiB, so a maximum three-snapshot
response is bounded below the 10 MiB batch-response limit.

On catch-up, a client pauses at a `source_snapshot` operation, batch-loads its
snapshot, applies that exact source/model/layout, then applies buffered later
operations by `opSeq`. Duplicate IDs/sequences are ignored and a sequence gap
uses the existing operations GET endpoint.
