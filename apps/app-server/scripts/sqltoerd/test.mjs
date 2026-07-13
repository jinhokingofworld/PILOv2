import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
require("reflect-metadata");

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const SQL_ERD_SESSION_DATA_MUTATION_PATTERN =
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.)?sql_erd_sessions\b/i;

const appModule = await readSource("../../src/app.module.ts");
const sqlErdModule = await readSource(
  "../../src/modules/sql-erd/sql-erd.module.ts"
);
const sqlErdController = await readSource(
  "../../src/modules/sql-erd/sql-erd.controller.ts"
);
const sqlErdService = await readSource(
  "../../src/modules/sql-erd/sql-erd.service.ts"
);
const sqlErdTypes = await readSource(
  "../../src/modules/sql-erd/sql-erd.types.ts"
);
const sqlErdValidation = await readSource(
  "../../src/modules/sql-erd/sql-erd.validation.ts"
);
const sqlErdMapper = await readSource(
  "../../src/modules/sql-erd/sql-erd.mapper.ts"
);
const sqlErdMultiSessionMigration = await readSource(
  "../../../../db/migrations/023_enable_sql_erd_multi_sessions.sql"
);
const dbReadme = await readSource("../../../../db/README.md");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { FastifyAdapter } = require("@nestjs/platform-fastify");
const { SessionService } = require("../../dist/common/session.service.js");
const { SqlErdService } = require(
  "../../dist/modules/sql-erd/sql-erd.service.js"
);
const { SqlErdSessionController } = require(
  "../../dist/modules/sql-erd/sql-erd.controller.js"
);
const { SQL_ERD_REQUEST_BODY_LIMIT_BYTES } = require(
  "../../dist/modules/sql-erd/sql-erd.types.js"
);
const { validateCreateSqlErdSessionRequest } = require(
  "../../dist/modules/sql-erd/sql-erd.validation.js"
);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const createdAt = new Date("2026-07-07T08:00:00.000Z");
const updatedAt = new Date("2026-07-07T08:05:00.000Z");
const deletedAt = new Date("2026-07-07T08:10:00.000Z");

assert.match(appModule, /SqlErdModule/);
assert.match(sqlErdModule, /controllers: \[SqlErdSessionController\]/);
assert.match(sqlErdModule, /providers: \[SqlErdService\]/);
assert.match(sqlErdModule, /WorkspaceModule/);
assert.match(sqlErdController, /@Controller\("workspaces\/:workspaceId"\)/);
assert.match(sqlErdController, /@UseGuards\(AuthGuard\)/);
assert.match(sqlErdController, /@Get\("sql-erd-session"\)/);
assert.match(sqlErdController, /@Post\("sql-erd-session"\)/);
assert.match(sqlErdController, /@Patch\("sql-erd-session\/:sessionId"\)/);
assert.match(sqlErdController, /@Delete\("sql-erd-session\/:sessionId"\)/);
assert.match(sqlErdController, /@Get\("sql-erd-sessions"\)/);
assert.match(sqlErdController, /@Post\("sql-erd-sessions"\)/);
assert.match(sqlErdController, /@Get\("sql-erd-sessions\/:sessionId"\)/);
assert.match(sqlErdController, /@Patch\("sql-erd-sessions\/:sessionId"\)/);
assert.match(sqlErdController, /@Delete\("sql-erd-sessions\/:sessionId"\)/);
assert.equal(sqlErdController.match(/@RouteConfig/g)?.length, 4);
assert.equal(sqlErdController.match(/bodyLimit/g)?.length, 4);
assert.match(sqlErdTypes, /SQL_ERD_REQUEST_BODY_LIMIT_BYTES = 2 \* 1024 \* 1024/);
assert.match(sqlErdService, /domain: "sqltoerd"/);
assert.match(sqlErdService, /apiContract: "docs\/api\/sqltoerd-api.md"/);
assert.match(sqlErdService, /assertWorkspaceAccess/);
assert.match(sqlErdService, /DatabaseService/);
assert.match(sqlErdService, /DatabaseTransaction/);
assert.match(sqlErdService, /database\.transaction/);
assert.match(sqlErdService, /FOR UPDATE/);
assert.match(sqlErdService, /FROM sql_erd_sessions/);
assert.match(sqlErdService, /INSERT INTO sql_erd_sessions/);
assert.match(sqlErdService, /UPDATE sql_erd_sessions/);
assert.match(sqlErdService, /revision = revision \+ 1/);
assert.match(sqlErdService, /deleted_at = now\(\)/);
assert.match(sqlErdService, /table_count/);
assert.match(sqlErdService, /relation_count/);
assert.match(sqlErdService, /created_by/);
assert.match(sqlErdService, /updated_by/);
assert.match(sqlErdService, /UNIQUE_VIOLATION_CODE/);
assert.match(sqlErdService, /CHECK_VIOLATION_CODE/);
assert.match(sqlErdService, /sql_erd_sessions_model_json_size_check/);
assert.match(sqlErdService, /sql_erd_sessions_layout_json_size_check/);
assert.match(sqlErdService, /sql_erd_sessions_settings_json_size_check/);
assert.match(
  sqlErdMultiSessionMigration,
  /DROP INDEX IF EXISTS public\.ux_sql_erd_sessions_workspace_active/
);
assert.match(
  sqlErdMultiSessionMigration,
  /DROP INDEX IF EXISTS public\.idx_sql_erd_sessions_workspace_updated_at/
);
assert.match(
  sqlErdMultiSessionMigration,
  /CREATE INDEX idx_sql_erd_sessions_workspace_updated_at_id/
);
assert.match(
  sqlErdMultiSessionMigration,
  /ON public\.sql_erd_sessions\s*\(workspace_id, updated_at DESC, id DESC\)\s*WHERE deleted_at IS NULL/s
);
[
  "INSERT INTO public.sql_erd_sessions (id) VALUES ('session-id')",
  "UPDATE sql_erd_sessions SET title = 'Updated'",
  "DELETE FROM public.sql_erd_sessions",
  "TRUNCATE public.sql_erd_sessions"
].forEach((statement) => {
  assert.match(statement, SQL_ERD_SESSION_DATA_MUTATION_PATTERN);
});
assert.doesNotMatch(
  sqlErdMultiSessionMigration,
  SQL_ERD_SESSION_DATA_MUTATION_PATTERN
);
assert.match(dbReadme, /023_enable_sql_erd_multi_sessions\.sql/);
assert.match(sqlErdValidation, /validateSqlErdSessionId/);
assert.match(sqlErdValidation, /validateCreateSqlErdSessionRequest/);
assert.match(sqlErdValidation, /validateUpdateSqlErdSessionRequest/);
assert.match(sqlErdValidation, /validateDeleteSqlErdSessionQuery/);
assert.match(sqlErdValidation, /MAX_MODEL_JSON_BYTES = 1024 \* 1024/);
assert.match(sqlErdValidation, /MAX_LAYOUT_JSON_BYTES = 1024 \* 1024/);
assert.match(sqlErdValidation, /MAX_SETTINGS_JSON_BYTES = 64 \* 1024/);
assert.match(sqlErdValidation, /MAX_COLUMN_COUNT = 1000/);
assert.match(sqlErdValidation, /MAX_COLUMNS_PER_TABLE = 200/);
assert.match(sqlErdValidation, /MAX_IDENTIFIER_LENGTH = 256/);
assert.match(sqlErdValidation, /MAX_COLUMN_TYPE_LENGTH = 512/);
assert.match(sqlErdValidation, /MAX_JSON_DEPTH = 20/);
assert.match(sqlErdValidation, /FORBIDDEN_JSON_KEYS/);
assert.match(sqlErdValidation, /readVersionedJsonObject/);
assert.match(sqlErdValidation, /assertJsonByteLength/);
assert.match(sqlErdValidation, /validateSqlErdLayoutJson/);
assert.match(sqlErdValidation, /readModelMetadata/);
assert.match(sqlErdValidation, /\$\{field\}\.version must be 1/);
assert.match(sqlErdMapper, /mapSqlErdSession/);
assert.match(sqlErdMapper, /mapDeletedSqlErdSession/);

class FakeDatabase {
  constructor({ queryRows = [], queryOneRows = [] } = {}) {
    this.queryRows = [...queryRows];
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
    this.transactions = [];
  }

  async query(text, values = []) {
    return this.readQuery(text, values, false);
  }

  async queryOne(text, values = []) {
    return this.readQueryOne(text, values, false);
  }

  async transaction(callback) {
    const transaction = {
      query: (text, values = []) => this.readQuery(text, values, true),
      queryOne: (text, values = []) => this.readQueryOne(text, values, true)
    };
    this.transactions.push(transaction);
    return callback(transaction);
  }

  async readQuery(text, values, transaction) {
    this.queries.push({ method: "query", text, values, transaction });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }

  async readQueryOne(text, values, transaction) {
    this.queries.push({ method: "queryOne", text, values, transaction });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }
}

function createSubject(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const service = new SqlErdService(database, workspaceService);
  return {
    database,
    service,
    workspaceService
  };
}

function column(id, name, dataType, overrides = {}) {
  return {
    id,
    name,
    dataType,
    nullable: true,
    primaryKey: false,
    foreignKey: false,
    unique: false,
    defaultValue: null,
    comment: null,
    ...overrides
  };
}

function table(id, name, columns, constraints = [], overrides = {}) {
  return {
    id,
    name,
    schemaName: null,
    columns,
    constraints,
    comment: null,
    ...overrides
  };
}

function constraint(id, kind, columnIds, overrides = {}) {
  return {
    id,
    kind,
    columnIds,
    name: null,
    ...overrides
  };
}

function relation(id, fromTableId, fromColumnIds, toTableId, toColumnIds, overrides = {}) {
  return {
    id,
    kind: "foreign_key",
    fromTableId,
    fromColumnIds,
    toTableId,
    toColumnIds,
    constraintName: null,
    ...overrides
  };
}

function modelJson(overrides = {}) {
  return {
    version: 1,
    schema: {
      tables: [
        table(
          "table_users",
          "users",
          [
            column("column_users_id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            column("column_users_email", "email", "VARCHAR(255)", {
              nullable: false,
              unique: true
            })
          ],
          [
            constraint("constraint_users_pk", "primary_key", ["column_users_id"]),
            constraint("constraint_users_email_unique", "unique", [
              "column_users_email"
            ])
          ]
        ),
        table(
          "table_orders",
          "orders",
          [
            column("column_orders_id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            }),
            column("column_orders_user_id", "user_id", "BIGINT", {
              nullable: false,
              foreignKey: true
            })
          ],
          [constraint("constraint_orders_pk", "primary_key", ["column_orders_id"])]
        )
      ],
      relations: [
        relation(
          "relation_orders_users",
          "table_orders",
          ["column_orders_user_id"],
          "table_users",
          ["column_users_id"],
          { constraintName: "fk_orders_user" }
        )
      ]
    },
    ...overrides
  };
}

function layoutJson(overrides = {}) {
  return {
    version: 1,
    tableLayouts: [],
    ...overrides
  };
}

function tableAnnotation(id, fromTableId, toTableId, overrides = {}) {
  return {
    id,
    kind: "table_link",
    fromTableId,
    toTableId,
    label: "",
    ...overrides
  };
}

function columnAnnotation(
  id,
  fromTableId,
  fromColumnId,
  toTableId,
  toColumnId,
  overrides = {}
) {
  return {
    id,
    kind: "column_link",
    fromTableId,
    fromColumnId,
    toTableId,
    toColumnId,
    label: "",
    ...overrides
  };
}

function annotations(links, overrides = {}) {
  return {
    version: 1,
    links,
    ...overrides
  };
}

function canvasNote(id, overrides = {}) {
  return {
    id,
    x: 120,
    y: 160,
    width: 240,
    height: 160,
    text: "Schema decision",
    ...overrides
  };
}

function canvasFrame(id, overrides = {}) {
  return {
    id,
    x: 80,
    y: 100,
    width: 640,
    height: 360,
    title: "Billing domain",
    color: "blue",
    isLocked: false,
    ...overrides
  };
}

function oversizedText(size) {
  return "x".repeat(size);
}

function deepObject(depth) {
  let value = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }

  return value;
}

function ownForbiddenKeyObject(key) {
  const value = {};
  Object.defineProperty(value, key, {
    value: "blocked",
    enumerable: true
  });
  return value;
}

function sessionRow(overrides = {}) {
  return {
    id: sessionId,
    workspace_id: workspaceId,
    title: "Commerce ERD",
    source_format: "sql",
    dialect: "postgresql",
    source_text: "CREATE TABLE users (id BIGINT PRIMARY KEY);",
    model_json: modelJson(),
    layout_json: layoutJson(),
    settings_json: {},
    table_count: 2,
    relation_count: 1,
    revision: 1,
    created_by: currentUserId,
    updated_by: currentUserId,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    ...overrides
  };
}

function sessionSummaryRow(overrides = {}) {
  const row = sessionRow(overrides);
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: row.title,
    source_format: row.source_format,
    dialect: row.dialect,
    table_count: row.table_count,
    relation_count: row.relation_count,
    revision: row.revision,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cursor_updated_at:
      overrides.cursor_updated_at ?? "2026-07-07T08:05:00.123456Z"
  };
}

function workspaceLockRow() {
  return { id: workspaceId };
}

class FakeSqlErdHttpService {
  constructor() {
    this.calls = [];
  }

  async getActiveSession() {
    this.calls.push("getActiveSession");
    return null;
  }

  async createSession() {
    this.calls.push("createSession");
    throw new Error("bodyLimit should reject before createSession");
  }

  async updateSession() {
    this.calls.push("updateSession");
    throw new Error("bodyLimit should reject before updateSession");
  }

  async deleteSession() {
    this.calls.push("deleteSession");
    return { id: sessionId, deletedAt: deletedAt.toISOString(), revision: 2 };
  }
}

async function createSqlErdHttpTestApp(sqlErdService) {
  class SqlErdBodyLimitTestModule {}
  Module({
    controllers: [SqlErdSessionController],
    providers: [
      {
        provide: SqlErdService,
        useValue: sqlErdService
      },
      {
        provide: SessionService,
        useValue: {
          async validateSessionToken() {
            return currentUserId;
          }
        }
      }
    ]
  })(SqlErdBodyLimitTestModule);

  const app = await NestFactory.create(
    SqlErdBodyLimitTestModule,
    new FastifyAdapter(),
    { abortOnError: false, logger: false }
  );
  app.setGlobalPrefix("api/v1");
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function oversizedHttpBody() {
  return JSON.stringify({
    sourceText: `CREATE TABLE secret_users (password TEXT); ${oversizedText(
      SQL_ERD_REQUEST_BODY_LIMIT_BYTES
    )}`
  });
}

async function assertRouteBodyLimit(method, url, blockedServiceCall) {
  const service = new FakeSqlErdHttpService();
  const app = await createSqlErdHttpTestApp(service);

  try {
    const response = await app.getHttpAdapter().getInstance().inject({
      method,
      url,
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      payload: oversizedHttpBody()
    });

    assert.equal(response.statusCode, 413);
    assert.doesNotMatch(response.body, /secret_users|password/);
    assert.equal(service.calls.includes(blockedServiceCall), false);
  } finally {
    await app.close();
  }
}

async function assertApiError(action, status, code, messagePattern, forbiddenPattern) {
  await assert.rejects(action, (error) => {
    const message = error.getResponse().error.message;
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().error.code, code);
    assert.match(message, messagePattern);
    if (forbiddenPattern) {
      assert.doesNotMatch(message, forbiddenPattern);
    }
    return true;
  });
}

await assertRouteBodyLimit(
  "POST",
  `/api/v1/workspaces/${workspaceId}/sql-erd-session`,
  "createSession"
);

await assertRouteBodyLimit(
  "POST",
  `/api/v1/workspaces/${workspaceId}/sql-erd-sessions`,
  "createPluralSession"
);

await assertRouteBodyLimit(
  "PATCH",
  `/api/v1/workspaces/${workspaceId}/sql-erd-sessions/${sessionId}`,
  "updateSession"
);

await assertRouteBodyLimit(
  "PATCH",
  `/api/v1/workspaces/${workspaceId}/sql-erd-session/${sessionId}`,
  "updateSession"
);

{
  const normalized = validateCreateSqlErdSessionRequest({
    dialect: "sqlite",
    sourceFormat: "sql",
    sourceText: "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    modelJson: modelJson(),
    layoutJson: layoutJson()
  });

  assert.equal(normalized.dialect, "sqlite");
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM sql_erd_sessions/);
        assert.match(text, /deleted_at IS NULL/);
        assert.match(text, /ORDER BY updated_at DESC, id DESC/);
        assert.match(text, /LIMIT 1/);
        assert.deepEqual(values, [workspaceId]);
        return sessionRow();
      }
    ]
  });
  const { service, workspaceService } = createSubject(database);

  const session = await service.getActiveSession(currentUserId, workspaceId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(session.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(session.tableCount, 2);
  assert.equal(session.relationCount, 1);
  assert.equal(session.revision, 1);
}

{
  const { service } = createSubject(new FakeDatabase({ queryOneRows: [null] }));

  const session = await service.getActiveSession(currentUserId, workspaceId);

  assert.equal(session, null);
}

{
  const firstId = "33333333-3333-4333-8333-333333333333";
  const secondId = "44444444-4444-4444-8444-444444444444";
  const thirdId = "55555555-5555-4555-8555-555555555555";
  const database = new FakeDatabase({
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM sql_erd_sessions/);
        assert.match(text, /ORDER BY updated_at DESC, id DESC/);
        assert.match(text, /LIMIT \$4/);
        assert.deepEqual(values, [workspaceId, null, null, 3]);
        return [
          sessionSummaryRow({ id: firstId }),
          sessionSummaryRow({
            id: secondId,
            updated_at: new Date("2026-07-07T08:04:00.123Z"),
            cursor_updated_at: "2026-07-07T08:04:00.123456Z"
          }),
          sessionSummaryRow({
            id: thirdId,
            updated_at: new Date("2026-07-07T08:03:00.123Z"),
            cursor_updated_at: "2026-07-07T08:03:00.123456Z"
          })
        ];
      }
    ]
  });
  const { service, workspaceService } = createSubject(database);

  assert.equal(typeof service.listSessions, "function");
  const result = await service.listSessions(currentUserId, workspaceId, {
    limit: "2"
  });

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, firstId);
  assert.equal(result.items[1].id, secondId);
  assert.equal(typeof result.nextCursor, "string");
  assert.equal("sourceText" in result.items[0], false);
  assert.equal("modelJson" in result.items[0], false);
  assert.equal("layoutJson" in result.items[0], false);
  assert.equal("settingsJson" in result.items[0], false);

  const nextDatabase = new FakeDatabase({
    queryRows: [
      (text, values) => {
        assert.match(text, /\(updated_at, id\) < \(\$2::timestamptz, \$3::uuid\)/);
        assert.deepEqual(values, [
          workspaceId,
          "2026-07-07T08:04:00.123456Z",
          secondId,
          21
        ]);
        return [];
      }
    ]
  });
  const { service: nextService } = createSubject(nextDatabase);
  const nextPage = await nextService.listSessions(currentUserId, workspaceId, {
    cursor: result.nextCursor
  });

  assert.deepEqual(nextPage, { items: [], nextCursor: null });
}

{
  const { service } = createSubject();

  for (const limit of ["0", "101", "1.5"]) {
    await assertApiError(
      () => service.listSessions(currentUserId, workspaceId, { limit }),
      400,
      "BAD_REQUEST",
      /limit must be an integer between 1 and 100/
    );
  }

  await assertApiError(
    () =>
      service.listSessions(currentUserId, workspaceId, {
        cursor: "not-a-server-cursor"
      }),
    400,
    "BAD_REQUEST",
    /cursor is invalid/
  );

  await assertApiError(
    () =>
      service.listSessions(currentUserId, workspaceId, {
        cursor: "x".repeat(2049)
      }),
    400,
    "BAD_REQUEST",
    /cursor is invalid/
  );

  await assertApiError(
    () =>
      service.listSessions(currentUserId, workspaceId, {
        limit: "20",
        sort: "title"
      }),
    400,
    "BAD_REQUEST",
    /unknown field/
  );
}

{
  const database = new FakeDatabase({ queryOneRows: [sessionRow()] });
  const { service } = createSubject(database);

  assert.equal(typeof service.getSession, "function");
  const session = await service.getSession(currentUserId, workspaceId, sessionId);

  assert.equal(session.id, sessionId);
  assert.equal(session.deletedAt, null);
}

{
  const database = new FakeDatabase({ queryOneRows: [null] });
  const { service } = createSubject(database);

  await assertApiError(
    () => service.getSession(currentUserId, workspaceId, sessionId),
    404,
    "NOT_FOUND",
    /session not found/
  );
}

{
  const sourceText = "CREATE TABLE users (id BIGINT PRIMARY KEY);";
  const requestModelJson = modelJson();
  const requestLayoutJson = layoutJson({
    annotations: annotations([
      tableAnnotation("annotation_users_orders", "table_users", "table_orders", {
        label: "places"
      })
    ])
  });
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM workspaces/);
        assert.match(text, /FOR UPDATE/);
        assert.deepEqual(values, [workspaceId]);
        return workspaceLockRow();
      },
      (text, values) => {
        assert.match(text, /FROM sql_erd_sessions/);
        assert.deepEqual(values, [workspaceId]);
        return null;
      },
      (text, values) => {
        assert.match(text, /INSERT INTO sql_erd_sessions/);
        assert.deepEqual(values, [
          workspaceId,
          "Commerce ERD",
          "sql",
          "postgresql",
          sourceText,
          JSON.stringify(requestModelJson),
          JSON.stringify(requestLayoutJson),
          JSON.stringify({}),
          2,
          1,
          currentUserId
        ]);
        return sessionRow({
          source_text: sourceText,
          model_json: requestModelJson,
          layout_json: requestLayoutJson
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const session = await service.createSession(currentUserId, workspaceId, {
    title: " Commerce ERD ",
    sourceFormat: "sql",
    dialect: "postgresql",
    sourceText,
    modelJson: requestModelJson,
    layoutJson: requestLayoutJson
  });

  assert.equal(session.title, "Commerce ERD");
  assert.equal(session.sourceText, sourceText);
  assert.equal(session.tableCount, 2);
  assert.equal(session.relationCount, 1);
  assert.deepEqual(session.layoutJson, requestLayoutJson);
  assert.equal(session.createdBy, currentUserId);
  assert.equal(session.updatedBy, currentUserId);
  assert.equal(database.transactions.length, 1);
  assert.equal(database.queries.every((query) => query.transaction), true);
}

{
  const database = new FakeDatabase({
    queryOneRows: [workspaceLockRow(), sessionRow()]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson()
      }),
    409,
    "CONFLICT",
    /active session already exists/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      workspaceLockRow(),
      null,
      () => {
        throw { code: "23505" };
      }
    ]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson()
      }),
    409,
    "CONFLICT",
    /active session already exists/
  );
}

{
  const sensitiveSql = "CREATE TABLE secret_users (password TEXT);";
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson({ filler: oversizedText(1024 * 1024) }),
        layoutJson: layoutJson()
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /modelJson is too large/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson({ filler: oversizedText(1024 * 1024) })
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /layoutJson is too large/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson(),
        settingsJson: { filler: oversizedText(64 * 1024) }
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /settingsJson is too large/,
    /secret_users|password/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      workspaceLockRow(),
      null,
      () => {
        throw {
          code: "23514",
          constraint: "sql_erd_sessions_model_json_size_check"
        };
      }
    ]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson()
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /JSON payload is too large/
  );
}

{
  const requestModelJson = modelJson();
  const requestLayoutJson = layoutJson();
  const database = new FakeDatabase({
    queryOneRows: [
      workspaceLockRow(),
      (text, values) => {
        assert.match(text, /INSERT INTO sql_erd_sessions/);
        assert.deepEqual(values, [
          workspaceId,
          "Untitled ERD",
          "sql",
          "auto",
          "",
          JSON.stringify(requestModelJson),
          JSON.stringify(requestLayoutJson),
          JSON.stringify({}),
          2,
          1,
          currentUserId
        ]);
        return sessionRow();
      }
    ]
  });
  const { service } = createSubject(database);

  assert.equal(typeof service.createPluralSession, "function");
  const session = await service.createPluralSession(currentUserId, workspaceId, {
    modelJson: requestModelJson,
    layoutJson: requestLayoutJson
  });

  assert.equal(session.id, sessionId);
  assert.equal(database.transactions.length, 1);
  assert.equal(
    database.queries.some((query) => /FROM sql_erd_sessions/.test(query.text)),
    false
  );
  assert.equal(database.queries.every((query) => query.transaction), true);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      workspaceLockRow(),
      () => {
        throw { code: "23505" };
      }
    ]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.createPluralSession(currentUserId, workspaceId, {
        modelJson: modelJson(),
        layoutJson: layoutJson()
      }),
    409,
    "CONFLICT",
    /database schema conflict/
  );
}

{
  const sensitiveSql = "CREATE TABLE secret_users (password TEXT);";
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson(),
        unexpected: true
      }),
    400,
    "BAD_REQUEST",
    /unknown field/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        sourceText: sensitiveSql,
        title: "Commerce ERD",
        unexpected: true
      }),
    400,
    "BAD_REQUEST",
    /unknown field/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson(),
        settingsJson: ownForbiddenKeyObject("constructor")
      }),
    400,
    "BAD_REQUEST",
    /forbidden key/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson(),
        settingsJson: deepObject(21)
      }),
    400,
    "BAD_REQUEST",
    /depth limit exceeded/,
    /secret_users|password/
  );
}

{
  const { service } = createSubject();
  const baseModel = modelJson();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            ...baseModel.schema,
            tables: [
              table("table_users", "users", [
                column("column_users_id", "id", "BIGINT")
              ]),
              table("table_users", "users_copy", [
                column("column_users_copy_id", "id", "BIGINT")
              ])
            ]
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /duplicate table id/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: [
              table("table_bad", "bad", [
                column("column_dup", "first", "BIGINT"),
                column("column_dup", "second", "BIGINT")
              ])
            ],
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /duplicate column id/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: [
              table(
                "table_bad",
                "bad",
                [column("column_bad_id", "id", "BIGINT")],
                [
                  constraint("constraint_bad", "primary_key", [
                    "column_missing"
                  ])
                ]
              )
            ],
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /constraint column reference is invalid/
  );
}

{
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({ extra: true }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /modelJson has unknown field/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            ...modelJson().schema,
            relations: [
              relation(
                "relation_missing_table",
                "table_missing",
                ["column_orders_user_id"],
                "table_users",
                ["column_users_id"]
              )
            ]
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /relation table reference is invalid/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            ...modelJson().schema,
            relations: [
              relation(
                "relation_mismatch",
                "table_orders",
                ["column_orders_user_id"],
                "table_users",
                ["column_users_id", "column_users_email"]
              )
            ]
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /relation column reference length mismatch/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            ...modelJson().schema,
            relations: [
              relation(
                "relation_missing_column",
                "table_orders",
                ["column_missing"],
                "table_users",
                ["column_users_id"]
              )
            ]
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /relation fromColumnIds reference is invalid/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            ...modelJson().schema,
            relations: [
              relation(
                "relation_duplicate",
                "table_orders",
                ["column_orders_user_id"],
                "table_users",
                ["column_users_id"]
              ),
              relation(
                "relation_duplicate",
                "table_orders",
                ["column_orders_user_id"],
                "table_users",
                ["column_users_id"]
              )
            ]
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /duplicate relation id/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            ...modelJson().schema,
            relations: [
              relation(
                "relation_missing_to_column",
                "table_orders",
                ["column_orders_user_id"],
                "table_users",
                ["column_missing"]
              )
            ]
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /relation toColumnIds reference is invalid/
  );
}

{
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: `CREATE TABLE secret_users (password TEXT); ${oversizedText(
          1024 * 1024
        )}`,
        modelJson: modelJson(),
        layoutJson: layoutJson()
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /sourceText is too large/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        sourceText: `CREATE TABLE secret_users (password TEXT); ${oversizedText(
          1024 * 1024
        )}`
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /sourceText is too large/,
    /secret_users|password/
  );
}

{
  const { service } = createSubject();
  const tooManyTables = Array.from({ length: 101 }, (_, index) =>
    table(`table_${index}`, `table_${index}`, [
      column(`column_${index}_id`, "id", "BIGINT")
    ])
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: tooManyTables,
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /table count limit exceeded/
  );

  const baseTables = [
    table("table_from", "from_table", [
      column("column_from_id", "id", "BIGINT")
    ]),
    table("table_to", "to_table", [column("column_to_id", "id", "BIGINT")])
  ];
  const tooManyRelations = Array.from({ length: 301 }, (_, index) =>
    relation(
      `relation_${index}`,
      "table_from",
      ["column_from_id"],
      "table_to",
      ["column_to_id"]
    )
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: baseTables,
            relations: tooManyRelations
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /relation count limit exceeded/
  );

  const tooManyTotalColumns = Array.from({ length: 6 }, (_, tableIndex) =>
    table(
      `table_total_${tableIndex}`,
      `total_${tableIndex}`,
      Array.from({ length: 167 }, (_, columnIndex) =>
        column(
          `column_total_${tableIndex}_${columnIndex}`,
          `column_${columnIndex}`,
          "BIGINT"
        )
      )
    )
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: tooManyTotalColumns,
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /column count limit exceeded/
  );

  const tooManyColumns = Array.from({ length: 201 }, (_, index) =>
    column(`column_too_many_${index}`, `column_${index}`, "BIGINT")
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: [table("table_wide", "wide", tooManyColumns)],
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /table column count limit exceeded/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: [
              table("table_bad", oversizedText(257), [
                column("column_bad_id", "id", "BIGINT")
              ])
            ],
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /length limit exceeded/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson({
          schema: {
            tables: [
              table("table_bad", "bad", [
                column("column_bad_id", "id", oversizedText(513))
              ])
            ],
            relations: []
          }
        }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /length limit exceeded/
  );
}

{
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson({ extra: true })
      }),
    400,
    "BAD_REQUEST",
    /layoutJson has unknown field/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson({
          tableLayouts: [
            { tableId: "table_users", x: 0, y: 0 },
            { tableId: "table_orders", x: 10, y: 10 },
            { tableId: "table_users", x: 20, y: 20 }
          ]
        })
      }),
    400,
    "BAD_REQUEST",
    /layoutJson.tableLayouts length limit exceeded/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson({
          tableLayouts: [{ tableId: "table_missing", x: 0, y: 0 }]
        })
      }),
    400,
    "BAD_REQUEST",
    /layoutJson.tableLayouts tableId reference is invalid/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson({
          tableLayouts: [
            { tableId: "table_users", x: 0, y: 0 },
            { tableId: "table_users", x: 10, y: 10 }
          ]
        })
      }),
    400,
    "BAD_REQUEST",
    /duplicate layout tableId/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson({
          tableLayouts: [{ tableId: "table_users", x: Number.NaN, y: 0 }]
        })
      }),
    400,
    "BAD_REQUEST",
    /must be a finite number/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        modelJson: modelJson(),
        layoutJson: layoutJson({
          viewport: { x: 0, y: 0, zoom: 0 }
        })
      }),
    400,
    "BAD_REQUEST",
    /zoom must be greater than 0/
  );
}

{
  const validAnnotations = annotations([
    tableAnnotation("annotation_users_orders", "table_users", "table_orders", {
      label: "places"
    }),
    columnAnnotation(
      "annotation_users_email_orders_user_id",
      "table_users",
      "column_users_email",
      "table_orders",
      "column_orders_user_id",
      { label: "business owner" }
    )
  ], {
    notes: [canvasNote("note_billing")],
    frames: [canvasFrame("frame_billing")]
  });
  const normalizedLegacy = validateCreateSqlErdSessionRequest({
    sourceFormat: "sql",
    modelJson: modelJson(),
    layoutJson: layoutJson()
  });
  const normalizedWithAnnotations = validateCreateSqlErdSessionRequest({
    sourceFormat: "sql",
    modelJson: modelJson(),
    layoutJson: layoutJson({ annotations: validAnnotations })
  });

  assert.equal("annotations" in normalizedLegacy.layoutJson, false);
  assert.deepEqual(normalizedWithAnnotations.layoutJson.annotations, validAnnotations);

  const invalidCases = [
    {
      layout: layoutJson({
        annotations: annotations([], {
          notes: Array.from({ length: 101 }, (_, index) =>
            canvasNote(`note_${index}`)
          )
        })
      }),
      message: /layoutJson\.annotations\.notes length limit exceeded/
    },
    {
      layout: layoutJson({
        annotations: annotations([], {
          frames: [canvasFrame("frame_invalid", { color: "purple" })]
        })
      }),
      message: /layoutJson\.annotations\.frames\[0\]\.color is invalid/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_duplicate_note", "table_users", "table_orders")
        ], { notes: [canvasNote("annotation_duplicate_note")] })
      }),
      message: /duplicate annotation id/
    },
    {
      layout: layoutJson({
        annotations: annotations([], { version: 2 })
      }),
      message: /layoutJson\.annotations\.version must be 1/
    },
    {
      layout: layoutJson({
        annotations: annotations(
          Array.from({ length: 301 }, (_, index) =>
            tableAnnotation(
              `annotation_${index}`,
              "table_users",
              "table_orders"
            )
          )
        )
      }),
      message: /layoutJson\.annotations\.links length limit exceeded/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_long_label", "table_users", "table_orders", {
            label: oversizedText(201)
          })
        ])
      }),
      message: /layoutJson\.annotations\.links\[0\]\.label length limit exceeded/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_missing_table", "table_missing", "table_orders")
        ])
      }),
      message: /annotation table reference is invalid/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          columnAnnotation(
            "annotation_missing_column",
            "table_users",
            "column_missing",
            "table_orders",
            "column_orders_user_id"
          )
        ])
      }),
      message: /annotation column reference is invalid/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_duplicate_id", "table_users", "table_orders"),
          columnAnnotation(
            "annotation_duplicate_id",
            "table_users",
            "column_users_email",
            "table_orders",
            "column_orders_user_id"
          )
        ])
      }),
      message: /duplicate annotation id/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_forward", "table_users", "table_orders"),
          tableAnnotation("annotation_reverse", "table_orders", "table_users")
        ])
      }),
      message: /duplicate annotation endpoint/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_unknown_field", "table_users", "table_orders", {
            extra: true
          })
        ])
      }),
      message: /layoutJson\.annotations\.links\[0\] has unknown field/
    },
    {
      layout: layoutJson({
        annotations: annotations([
          tableAnnotation("annotation_unknown_kind", "table_users", "table_orders", {
            kind: "unknown_link"
          })
        ])
      }),
      message: /layoutJson\.annotations\.links\[0\]\.kind is invalid/
    }
  ];

  for (const invalidCase of invalidCases) {
    await assertApiError(
      async () =>
        validateCreateSqlErdSessionRequest({
          sourceFormat: "sql",
          modelJson: modelJson(),
          layoutJson: invalidCase.layout
        }),
      400,
      "BAD_REQUEST",
      invalidCase.message
    );
  }
}

{
  const baseModelJson = modelJson();
  const compositeModelJson = modelJson({
    schema: {
      tables: [
        table(
          "table_users",
          "users",
          [
            ...baseModelJson.schema.tables[0].columns,
            column("column_users_tenant_id", "tenant_id", "BIGINT")
          ],
          baseModelJson.schema.tables[0].constraints
        ),
        table(
          "table_orders",
          "orders",
          [
            ...baseModelJson.schema.tables[1].columns,
            column("column_orders_tenant_id", "tenant_id", "BIGINT")
          ],
          baseModelJson.schema.tables[1].constraints
        )
      ],
      relations: [
        relation(
          "relation_orders_users_composite",
          "table_orders",
          ["column_orders_user_id", "column_orders_tenant_id"],
          "table_users",
          ["column_users_id", "column_users_tenant_id"]
        )
      ]
    }
  });
  const collisionCases = [
    {
      model: baseModelJson,
      link: columnAnnotation(
        "annotation_fk_forward",
        "table_orders",
        "column_orders_user_id",
        "table_users",
        "column_users_id"
      )
    },
    {
      model: baseModelJson,
      link: columnAnnotation(
        "annotation_fk_reverse",
        "table_users",
        "column_users_id",
        "table_orders",
        "column_orders_user_id"
      )
    },
    {
      model: compositeModelJson,
      link: columnAnnotation(
        "annotation_fk_composite_member",
        "table_orders",
        "column_orders_tenant_id",
        "table_users",
        "column_users_tenant_id"
      )
    }
  ];

  for (const collisionCase of collisionCases) {
    const collisionLayoutJson = layoutJson({
      annotations: annotations([collisionCase.link])
    });
    const normalized = validateCreateSqlErdSessionRequest({
      sourceFormat: "sql",
      modelJson: collisionCase.model,
      layoutJson: collisionLayoutJson
    });

    assert.deepEqual(normalized.layoutJson, collisionLayoutJson);
  }

  const collisionLayoutJson = layoutJson({
    annotations: annotations([collisionCases[0].link])
  });
  const database = new FakeDatabase({
    queryOneRows: [
      sessionRow({ revision: 2 }),
      sessionRow({ revision: 3, layout_json: collisionLayoutJson })
    ]
  });
  const { service } = createSubject(database);

  const session = await service.updateSession(
    currentUserId,
    workspaceId,
    sessionId,
    {
      baseRevision: 2,
      layoutJson: collisionLayoutJson
    }
  );

  assert.deepEqual(session.layoutJson, collisionLayoutJson);
}

{
  const existingLayoutJson = layoutJson({
    annotations: annotations([
      tableAnnotation("annotation_users_orders", "table_users", "table_orders")
    ])
  });
  const usersOnlyModelJson = modelJson({
    schema: {
      tables: [modelJson().schema.tables[0]],
      relations: []
    }
  });
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        sessionRow({ revision: 2, layout_json: existingLayoutJson })
      ]
    })
  );

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 2,
        modelJson: usersOnlyModelJson
      }),
    400,
    "BAD_REQUEST",
    /annotation table reference is invalid/
  );
}

{
  const updatedSourceText = "CREATE TABLE users (id BIGINT PRIMARY KEY, email TEXT);";
  const updatedModelJson = modelJson({
    schema: {
      tables: [
        ...modelJson().schema.tables,
        table(
          "table_products",
          "products",
          [
            column("column_products_id", "id", "BIGINT", {
              nullable: false,
              primaryKey: true
            })
          ],
          [
            constraint("constraint_products_pk", "primary_key", [
              "column_products_id"
            ])
          ]
        )
      ],
      relations: [
        ...modelJson().schema.relations,
        relation(
          "relation_products_users",
          "table_products",
          ["column_products_id"],
          "table_users",
          ["column_users_id"],
          { constraintName: "fk_products_user" }
        )
      ]
    }
  });
  const updatedLayoutJson = {
    version: 1,
    tableLayouts: [{ tableId: "table_users", x: 10, y: 20 }],
    annotations: annotations([
      columnAnnotation(
        "annotation_users_email_orders_user_id",
        "table_users",
        "column_users_email",
        "table_orders",
        "column_orders_user_id",
        { label: "business owner" }
      )
    ])
  };
  const updatedSettingsJson = { panel: { leftCollapsed: false } };
  const database = new FakeDatabase({
    queryOneRows: [
      sessionRow({ revision: 3 }),
      (text, values) => {
        assert.match(text, /UPDATE sql_erd_sessions/);
        assert.match(text, /AND revision = \$13/);
        assert.deepEqual(values, [
          workspaceId,
          sessionId,
          "Commerce ERD v2",
          "sql",
          "mysql",
          updatedSourceText,
          JSON.stringify(updatedModelJson),
          JSON.stringify(updatedLayoutJson),
          JSON.stringify(updatedSettingsJson),
          3,
          2,
          currentUserId,
          3
        ]);
        return sessionRow({
          title: "Commerce ERD v2",
          dialect: "mysql",
          source_text: updatedSourceText,
          model_json: updatedModelJson,
          layout_json: updatedLayoutJson,
          settings_json: updatedSettingsJson,
          table_count: 3,
          relation_count: 2,
          revision: 4,
          updated_by: currentUserId
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const session = await service.updateSession(currentUserId, workspaceId, sessionId, {
    baseRevision: 3,
    title: "Commerce ERD v2",
    sourceFormat: "sql",
    dialect: "mysql",
    sourceText: updatedSourceText,
    modelJson: updatedModelJson,
    layoutJson: updatedLayoutJson,
    settingsJson: updatedSettingsJson
  });

  assert.equal(session.title, "Commerce ERD v2");
  assert.equal(session.dialect, "mysql");
  assert.equal(session.tableCount, 3);
  assert.equal(session.relationCount, 2);
  assert.deepEqual(session.layoutJson, updatedLayoutJson);
  assert.equal(session.revision, 4);
  assert.equal(session.updatedBy, currentUserId);
}

{
  const existingRow = sessionRow({
    title: "Old ERD",
    source_text: "CREATE TABLE old_table (id BIGINT PRIMARY KEY);",
    revision: 2,
    table_count: 2,
    relation_count: 1
  });
  const database = new FakeDatabase({
    queryOneRows: [
      existingRow,
      (text, values) => {
        assert.match(text, /UPDATE sql_erd_sessions/);
        assert.deepEqual(values, [
          workspaceId,
          sessionId,
          "Renamed ERD",
          existingRow.source_format,
          existingRow.dialect,
          existingRow.source_text,
          JSON.stringify(existingRow.model_json),
          JSON.stringify(existingRow.layout_json),
          JSON.stringify(existingRow.settings_json),
          2,
          1,
          currentUserId,
          2
        ]);
        return sessionRow({
          ...existingRow,
          title: "Renamed ERD",
          revision: 3,
          updated_by: currentUserId
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const session = await service.updateSession(currentUserId, workspaceId, sessionId, {
    baseRevision: 2,
    title: "Renamed ERD"
  });

  assert.equal(session.title, "Renamed ERD");
  assert.equal(session.sourceText, existingRow.source_text);
  assert.equal(session.tableCount, 2);
  assert.equal(session.relationCount, 1);
  assert.equal(session.revision, 3);
}

{
  const database = new FakeDatabase({ queryOneRows: [sessionRow({ revision: 5 })] });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 4,
        title: "Stale ERD"
      }),
    409,
    "CONFLICT",
    /revision conflict/
  );
}

{
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1
      }),
    400,
    "BAD_REQUEST",
    /At least one update field is required/
  );
}

{
  const sensitiveSql = "CREATE TABLE secret_users (password TEXT);";
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        sourceText: sensitiveSql,
        modelJson: modelJson({ filler: oversizedText(1024 * 1024) })
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /modelJson is too large/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        sourceText: sensitiveSql,
        layoutJson: layoutJson({ filler: oversizedText(1024 * 1024) })
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /layoutJson is too large/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        sourceText: sensitiveSql,
        settingsJson: { filler: oversizedText(64 * 1024) }
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /settingsJson is too large/,
    /secret_users|password/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      sessionRow({ revision: 1 }),
      () => {
        throw {
          code: "23514",
          constraint: "sql_erd_sessions_layout_json_size_check"
        };
      }
    ]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        layoutJson: layoutJson()
      }),
    413,
    "PAYLOAD_TOO_LARGE",
    /JSON payload is too large/
  );
}

{
  const database = new FakeDatabase({ queryOneRows: [null] });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        title: "Missing ERD"
      }),
    404,
    "NOT_FOUND",
    /session not found/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [sessionRow({ revision: 3 }), null, sessionRow({ revision: 4 })]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 3,
        title: "Race ERD"
      }),
    409,
    "CONFLICT",
    /revision conflict/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /UPDATE sql_erd_sessions/);
        assert.match(text, /deleted_at = now\(\)/);
        assert.match(text, /AND revision = \$3/);
        assert.deepEqual(values, [workspaceId, sessionId, 4, currentUserId]);
        return sessionRow({
          deleted_at: deletedAt,
          revision: 5,
          updated_by: currentUserId
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const result = await service.deleteSession(currentUserId, workspaceId, sessionId, {
    baseRevision: "4"
  });

  assert.deepEqual(result, {
    id: sessionId,
    deletedAt: deletedAt.toISOString(),
    revision: 5
  });
}

{
  const database = new FakeDatabase({
    queryOneRows: [null, sessionRow({ revision: 6 })]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.deleteSession(currentUserId, workspaceId, sessionId, {
        baseRevision: "5"
      }),
    409,
    "CONFLICT",
    /revision conflict/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [null, null]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () =>
      service.deleteSession(currentUserId, workspaceId, sessionId, {
        baseRevision: "1"
      }),
    404,
    "NOT_FOUND",
    /session not found/
  );
}

{
  const { service } = createSubject();

  await assertApiError(
    () => service.deleteSession(currentUserId, workspaceId, sessionId, {}),
    400,
    "BAD_REQUEST",
    /baseRevision is required/
  );
}

{
  const sensitiveSql = "CREATE TABLE secret_users (password TEXT);";
  const { service } = createSubject();

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "prisma",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /sourceFormat is invalid/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson({ version: 2 }),
        layoutJson: layoutJson()
      }),
    400,
    "BAD_REQUEST",
    /modelJson\.version must be 1/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.createSession(currentUserId, workspaceId, {
        sourceFormat: "sql",
        dialect: "postgresql",
        sourceText: sensitiveSql,
        modelJson: modelJson(),
        layoutJson: layoutJson({ version: 2 })
      }),
    400,
    "BAD_REQUEST",
    /layoutJson\.version must be 1/,
    /secret_users|password/
  );

  await assertApiError(
    () =>
      service.updateSession(currentUserId, workspaceId, sessionId, {
        baseRevision: 1,
        sourceText: sensitiveSql,
        modelJson: modelJson({ version: 2 })
      }),
    400,
    "BAD_REQUEST",
    /modelJson\.version must be 1/,
    /secret_users|password/
  );
}
