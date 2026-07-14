import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("reflect-metadata");
const { SqlErdService } = require(
  "../../dist/modules/sql-erd/sql-erd.service.js"
);
const {
  validateCreateSqlErdOperationRequest,
  validateListSqlErdOperationsQuery
} = require("../../dist/modules/sql-erd/sql-erd-operation.validation.js");

const migrationFilenames = await readdir(
  new URL("../../../../db/migrations/", import.meta.url)
);

assert.ok(
  migrationFilenames.includes("061_create_sql_erd_operation_delivery.sql"),
  "SQLtoERD operation delivery migration must exist"
);

const migration = await readFile(
  new URL(
    "../../../../db/migrations/061_create_sql_erd_operation_delivery.sql",
    import.meta.url
  ),
  "utf8"
);
const apiDocument = await readFile(
  new URL("../../../../docs/api/sqltoerd-api.md", import.meta.url),
  "utf8"
);

assert.match(migration, /ADD COLUMN write_protocol TEXT NOT NULL DEFAULT 'snapshot'/);
assert.match(migration, /write_protocol IN \('snapshot', 'operations_v1'\)/);
assert.match(migration, /ADD COLUMN latest_op_seq BIGINT NOT NULL DEFAULT 0/);
assert.match(migration, /CREATE TABLE public\.sql_erd_session_operations/);
assert.match(migration, /UNIQUE \(session_id, op_seq\)/);
assert.match(
  migration,
  /UNIQUE \(session_id, actor_user_id, client_operation_id\)/
);
assert.match(migration, /CREATE TABLE public\.sql_erd_session_operation_outbox/);
assert.match(migration, /status IN \('pending', 'publishing', 'delivered'\)/);
assert.match(
  migration,
  /idx_sql_erd_operation_outbox_publishing_claimed_at/
);
assert.match(
  migration,
  /ALTER TABLE public\.sql_erd_session_operations ENABLE ROW LEVEL SECURITY/
);
assert.match(
  migration,
  /ALTER TABLE public\.sql_erd_session_operation_outbox ENABLE ROW LEVEL SECURITY/
);
assert.match(
  apiDocument,
  /GET` \| `\/workspaces\/\{workspaceId\}\/sql-erd-sessions\/\{sessionId\}\/operations/
);
assert.match(
  apiDocument,
  /POST` \| `\/workspaces\/\{workspaceId\}\/sql-erd-sessions\/\{sessionId\}\/operations/
);
assert.match(apiDocument, /latestOpSeq: number/);
assert.match(apiDocument, /type PatchCollection<T>/);
assert.match(apiDocument, /SQL_ERD_WRITE_PROTOCOL_MISMATCH/);
assert.match(apiDocument, /"sql-erd:operation" = SqltoerdLayoutPatchOperation/);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

class FakeDatabase {
  constructor(session, existingOperation = null, operationRows = []) {
    this.existingOperation = existingOperation;
    this.operation = null;
    this.operationRows = operationRows;
    this.outboxOperationId = null;
    this.queries = [];
    this.session = session;
  }

  async transaction(callback) {
    return callback({
      execute: (text, values = []) => this.execute(text, values),
      query: (text, values = []) => this.query(text, values),
      queryOne: (text, values = []) => this.queryOne(text, values)
    });
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    if (text.includes("FROM sql_erd_session_operations")) {
      return this.operationRows;
    }
    return [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    if (text.includes("FROM sql_erd_sessions")) {
      return this.session;
    }
    if (text.includes("FROM sql_erd_session_operations")) {
      return this.existingOperation;
    }
    if (text.includes("UPDATE sql_erd_sessions")) {
      this.session = {
        ...this.session,
        layout_json: JSON.parse(values[2]),
        latest_op_seq: Number(this.session.latest_op_seq) + 1,
        revision: Number(this.session.revision) + 1,
        updated_by: values[3]
      };
      return this.session;
    }
    if (text.includes("INSERT INTO sql_erd_session_operations")) {
      this.operation = {
        id: "44444444-4444-4444-8444-444444444444",
        workspace_id: values[0],
        session_id: values[1],
        actor_user_id: values[2],
        operation_type: values[3],
        op_seq: values[4],
        client_operation_id: values[5],
        base_revision: values[6],
        applied_on_revision: values[7],
        result_revision: values[8],
        payload: JSON.parse(values[9]),
        created_at: new Date("2026-07-14T12:00:00.000Z")
      };
      return this.operation;
    }
    return null;
  }

  async execute(text, values = []) {
    this.queries.push({ text, values });
    if (text.includes("INSERT INTO sql_erd_session_operation_outbox")) {
      this.outboxOperationId = values[0];
    }
    return { rowCount: 1, rows: [] };
  }
}

const workspaceService = {
  async assertWorkspaceAccess() {
    return { id: workspaceId };
  }
};

function sessionRow(overrides = {}) {
  return {
    id: sessionId,
    workspace_id: workspaceId,
    title: "Operation test",
    source_format: "sql",
    dialect: "postgresql",
    source_text: "",
    model_json: { version: 1, schema: { tables: [], relations: [] } },
    layout_json: { version: 1, tableLayouts: [] },
    settings_json: {},
    table_count: 0,
    relation_count: 0,
    revision: 2,
    write_protocol: "operations_v1",
    latest_op_seq: 4,
    created_by: currentUserId,
    updated_by: currentUserId,
    created_at: new Date("2026-07-14T10:00:00.000Z"),
    updated_at: new Date("2026-07-14T10:00:00.000Z"),
    deleted_at: null,
    ...overrides
  };
}

const service = new SqlErdService(new FakeDatabase(sessionRow()), workspaceService);

const operationRequestFixture = {
  baseRevision: 1,
  clientOperationId: "note-create-1",
  type: "layout_patch",
  patch: {
    annotations: {
      notes: {
        upsert: [
          {
            id: "note-1",
            x: 120,
            y: 160,
            width: 240,
            height: 160,
            text: "Remote schema decision"
          }
        ]
      }
    }
  }
};

const normalizedOperationFixture = validateCreateSqlErdOperationRequest(
  operationRequestFixture
);
assert.equal(normalizedOperationFixture.clientOperationId, "note-create-1");
assert.deepEqual(normalizedOperationFixture.patch.annotations.notes.upsert, operationRequestFixture.patch.annotations.notes.upsert);
assert.deepEqual(validateListSqlErdOperationsQuery({ afterSeq: "0", limit: "100" }), {
  afterSeq: 0,
  limit: 100
});

assert.equal(
  typeof service.createOperation,
  "function",
  "SQLtoERD service must expose an operation write method"
);

{
  const database = new FakeDatabase(sessionRow());
  const operationService = new SqlErdService(database, workspaceService);
  const result = await operationService.createOperation(
    currentUserId,
    workspaceId,
    sessionId,
    operationRequestFixture
  );

  assert.equal(result.revision, 3);
  assert.equal(result.latestOpSeq, 5);
  assert.equal(result.operation.opSeq, 5);
  assert.equal(result.operation.rebased, true);
  assert.equal(result.operation.appliedOnRevision, 2);
  assert.equal(result.operation.resultRevision, 3);
  assert.deepEqual(result.layoutJson.annotations.notes, [
    {
      id: "note-1",
      x: 120,
      y: 160,
      width: 240,
      height: 160,
      text: "Remote schema decision"
    }
  ]);
  assert.equal(database.outboxOperationId, result.operation.id);
}

{
  const existingOperation = {
    id: "44444444-4444-4444-8444-444444444444",
    workspace_id: workspaceId,
    session_id: sessionId,
    actor_user_id: currentUserId,
    operation_type: "layout_patch",
    op_seq: 4,
    client_operation_id: "note-create-1",
    base_revision: 1,
    applied_on_revision: 1,
    result_revision: 2,
    payload: { annotations: { notes: { deleteIds: ["note-1"] } } },
    created_at: new Date("2026-07-14T12:00:00.000Z")
  };
  const database = new FakeDatabase(sessionRow(), existingOperation);
  const operationService = new SqlErdService(database, workspaceService);
  const result = await operationService.createOperation(
    currentUserId,
    workspaceId,
    sessionId,
    {
      baseRevision: 2,
      clientOperationId: "note-create-1",
      type: "layout_patch",
      patch: { viewport: { action: "delete" } }
    }
  );

  assert.equal(result.operation.id, existingOperation.id);
  assert.equal(database.outboxOperationId, null);
  assert.equal(
    database.queries.some(({ text }) => text.includes("UPDATE sql_erd_sessions")),
    false
  );
}

{
  const database = new FakeDatabase(sessionRow({ write_protocol: "snapshot" }));
  const operationService = new SqlErdService(database, workspaceService);
  await assert.rejects(
    () =>
      operationService.createOperation(currentUserId, workspaceId, sessionId, {
        baseRevision: 2,
        clientOperationId: "snapshot-blocked",
        type: "layout_patch",
        patch: { viewport: { action: "delete" } }
      }),
    (error) =>
      error.getStatus() === 409 &&
      error.getResponse().error.code === "SQL_ERD_WRITE_PROTOCOL_MISMATCH"
  );
}

{
  const database = new FakeDatabase(sessionRow(), null, [
    {
      id: "55555555-5555-4555-8555-555555555555",
      workspace_id: workspaceId,
      session_id: sessionId,
      actor_user_id: currentUserId,
      operation_type: "layout_patch",
      op_seq: 4,
      client_operation_id: "prior-operation",
      base_revision: 1,
      applied_on_revision: 2,
      result_revision: 3,
      payload: { viewport: { action: "delete" } },
      created_at: new Date("2026-07-14T12:00:00.000Z")
    }
  ]);
  const operationService = new SqlErdService(database, workspaceService);
  const result = await operationService.listOperations(
    currentUserId,
    workspaceId,
    sessionId,
    { afterSeq: 0, limit: 100 }
  );

  assert.equal(result.latestOpSeq, 4);
  assert.equal(result.items[0].opSeq, 4);
  assert.equal(result.nextAfterSeq, null);
  assert.match(
    database.queries[0].text,
    /FROM sql_erd_sessions[\s\S]*FOR UPDATE/,
    "catch-up must lock the session watermark before reading operation rows"
  );
  assert.match(database.queries[1].text, /FROM sql_erd_session_operations/);
}

{
  const database = new FakeDatabase(sessionRow());
  const operationService = new SqlErdService(database, workspaceService);
  await assert.rejects(
    () =>
      operationService.createOperation(currentUserId, workspaceId, sessionId, {
        baseRevision: 3,
        clientOperationId: "future-revision",
        type: "layout_patch",
        patch: { viewport: { action: "delete" } }
      }),
    (error) => error.getStatus() === 409 && error.getResponse().error.code === "CONFLICT"
  );
}
