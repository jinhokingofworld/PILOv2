import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

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
const require = createRequire(import.meta.url);
const { SqlErdService } = require(
  "../../dist/modules/sql-erd/sql-erd.service.js"
);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const createdAt = new Date("2026-07-07T08:00:00.000Z");
const updatedAt = new Date("2026-07-07T08:05:00.000Z");

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
assert.equal(sqlErdController.match(/@RouteConfig/g)?.length, 2);
assert.equal(sqlErdController.match(/bodyLimit/g)?.length, 2);
assert.match(sqlErdTypes, /SQL_ERD_REQUEST_BODY_LIMIT_BYTES = 2 \* 1024 \* 1024/);
assert.match(sqlErdService, /domain: "sqltoerd"/);
assert.match(sqlErdService, /apiContract: "docs\/api\/sqltoerd-api.md"/);
assert.match(sqlErdService, /assertWorkspaceAccess/);
assert.match(sqlErdService, /DatabaseService/);
assert.match(sqlErdService, /FROM sql_erd_sessions/);
assert.match(sqlErdService, /INSERT INTO sql_erd_sessions/);
assert.match(sqlErdService, /table_count/);
assert.match(sqlErdService, /relation_count/);
assert.match(sqlErdService, /created_by/);
assert.match(sqlErdService, /updated_by/);
assert.match(sqlErdService, /UNIQUE_VIOLATION_CODE/);
assert.match(sqlErdValidation, /validateSqlErdSessionId/);
assert.match(sqlErdValidation, /validateCreateSqlErdSessionRequest/);
assert.match(sqlErdValidation, /readVersionedJsonObject/);
assert.match(sqlErdValidation, /\$\{field\}\.version must be 1/);
assert.match(sqlErdMapper, /mapSqlErdSession/);

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
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

function modelJson(overrides = {}) {
  return {
    version: 1,
    schema: {
      tables: [{ id: "table_users" }, { id: "table_orders" }],
      relations: [{ id: "relation_orders_users" }]
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

function sessionRow(overrides = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
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

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM sql_erd_sessions/);
        assert.match(text, /deleted_at IS NULL/);
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
  const sourceText = "CREATE TABLE users (id BIGINT PRIMARY KEY);";
  const requestModelJson = modelJson();
  const requestLayoutJson = layoutJson();
  const database = new FakeDatabase({
    queryOneRows: [
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
  assert.equal(session.createdBy, currentUserId);
  assert.equal(session.updatedBy, currentUserId);
}

{
  const database = new FakeDatabase({ queryOneRows: [sessionRow()] });
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
}
