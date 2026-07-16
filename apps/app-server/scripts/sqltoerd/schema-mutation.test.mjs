import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("reflect-metadata");
const { SqlErdService } = require("../../dist/modules/sql-erd/sql-erd.service.js");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const agentRunId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const snapshotId = "55555555-5555-4555-8555-555555555555";
const operationId = "66666666-6666-4666-8666-666666666666";
const now = "2026-07-16T00:00:00.000Z";

function schemaSpec(overrides = {}) {
  return {
    version: 1,
    title: "Agent generated schema",
    requestedDialect: "postgresql",
    tables: [
      {
        key: "users",
        name: "users",
        schemaName: null,
        columns: [column("id", "id", true)],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      }
    ],
    relations: [],
    unsupportedFeatures: [],
    ...overrides
  };
}

function column(key, name, autoIncrement = false) {
  return {
    key,
    name,
    dataType: {
      kind: "bigint",
      length: null,
      precision: null,
      scale: null
    },
    nullable: false,
    autoIncrement,
    defaultValue: null
  };
}

function sessionRow(overrides = {}) {
  return {
    id: sessionId,
    workspace_id: workspaceId,
    title: "Existing title",
    source_format: "sql",
    dialect: "postgresql",
    source_text: "CREATE TABLE users (id BIGINT);",
    model_json: {
      version: 1,
      schema: {
        tables: [
          {
            id: "table.users",
            name: "users",
            schemaName: null,
            columns: [
              {
                id: "column.users.id",
                name: "id",
                dataType: "BIGINT",
                nullable: false,
                primaryKey: true,
                foreignKey: false,
                unique: false,
                defaultValue: null,
                comment: null
              }
            ],
            constraints: [
              {
                id: "constraint.users.pk",
                kind: "primary_key",
                columnIds: ["column.users.id"],
                name: null
              }
            ],
            comment: null
          }
        ],
        relations: []
      }
    },
    layout_json: {
      version: 1,
      tableLayouts: [{ tableId: "table.users", x: 321, y: 123, width: 300 }]
    },
    settings_json: {},
    table_count: 1,
    relation_count: 0,
    revision: 5,
    write_protocol: "operations_v1",
    latest_op_seq: 2,
    created_by: actorUserId,
    updated_by: actorUserId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...overrides
  };
}

class MutationDatabase {
  constructor(mode) {
    this.mode = mode;
    this.ledger = null;
    this.session = mode === "replace" ? sessionRow() : null;
    this.operation = null;
    this.snapshot = null;
    this.activeLock = null;
    this.executedSql = [];
  }

  async transaction(callback) {
    return callback(this);
  }

  async queryOne(sql, params) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.executedSql.push(normalized);

    if (normalized.includes("FROM workspaces") && normalized.includes("FOR UPDATE")) {
      return { id: workspaceId };
    }
    if (normalized.includes("FROM sql_erd_agent_session_creations")) {
      return this.ledger;
    }
    if (normalized.startsWith("INSERT INTO sql_erd_sessions")) {
      this.session = sessionRow({
        title: params[1],
        dialect: params[3],
        source_text: params[4],
        model_json: JSON.parse(params[5]),
        layout_json: JSON.parse(params[6]),
        table_count: params[8],
        relation_count: params[9],
        revision: 1,
        latest_op_seq: 0,
        write_protocol: params[10]
      });
      return this.session;
    }
    if (
      normalized.includes("FROM sql_erd_sessions") &&
      normalized.includes("id = $2")
    ) {
      return this.session;
    }
    if (normalized.includes("FROM sql_erd_session_operations")) {
      return this.operation;
    }
    if (normalized.includes("FROM sql_erd_session_source_locks")) {
      return this.activeLock;
    }
    if (normalized.startsWith("UPDATE sql_erd_sessions")) {
      this.session = sessionRow({
        source_format: params[2],
        dialect: params[3],
        source_text: params[4],
        model_json: JSON.parse(params[5]),
        layout_json: JSON.parse(params[6]),
        table_count: params[7],
        relation_count: params[8],
        revision: Number(this.session.revision) + 1,
        latest_op_seq: Number(this.session.latest_op_seq) + 1
      });
      return this.session;
    }
    if (normalized.startsWith("INSERT INTO sql_erd_session_source_snapshots")) {
      this.snapshot = {
        id: snapshotId,
        workspace_id: workspaceId,
        session_id: sessionId,
        source_format: params[2],
        dialect: params[3],
        source_text: params[4],
        model_json: JSON.parse(params[5]),
        layout_json: JSON.parse(params[6]),
        table_count: params[7],
        relation_count: params[8],
        base_revision: params[9],
        result_revision: params[10],
        created_by: params[11],
        created_at: now
      };
      return this.snapshot;
    }
    if (normalized.startsWith("INSERT INTO sql_erd_session_operations")) {
      this.operation = {
        id: operationId,
        workspace_id: workspaceId,
        session_id: sessionId,
        actor_user_id: actorUserId,
        operation_type: "source_snapshot",
        op_seq: params[3],
        client_operation_id: params[4],
        base_revision: params[5],
        applied_on_revision: params[6],
        result_revision: params[7],
        payload: JSON.parse(params[8]),
        source_snapshot_id: params[9],
        request_fingerprint: params[10],
        created_at: now
      };
      return this.operation;
    }
    if (normalized.includes("FROM sql_erd_session_source_snapshots")) {
      return this.snapshot;
    }

    throw new Error(`Unexpected queryOne: ${normalized}`);
  }

  async execute(sql, params) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.executedSql.push(normalized);
    if (normalized.startsWith("INSERT INTO sql_erd_agent_session_creations")) {
      this.ledger = {
        request_fingerprint: params[3],
        session_id: params[4]
      };
      return;
    }
    if (normalized.startsWith("INSERT INTO sql_erd_session_operation_outbox")) {
      return;
    }
    throw new Error(`Unexpected execute: ${normalized}`);
  }
}

const workspaceService = {
  calls: [],
  async assertWorkspaceAccess(userId, requestedWorkspaceId) {
    this.calls.push([userId, requestedWorkspaceId]);
  }
};

process.env.SQL_ERD_OPERATIONS_V1_ENABLED = "true";

const createDatabase = new MutationDatabase("create");
const createService = new SqlErdService(createDatabase, workspaceService);
const created = await createService.createAgentGeneratedSession(
  actorUserId,
  workspaceId,
  agentRunId,
  schemaSpec()
);
assert.equal(created.session.title, "Agent generated schema");
assert.equal(created.session.writeProtocol, "operations_v1");
assert.equal(created.session.revision, 1);
assert.equal(created.warnings.length, 0);
assert.ok(createDatabase.ledger);

const retried = await createService.createAgentGeneratedSession(
  actorUserId,
  workspaceId,
  agentRunId,
  schemaSpec()
);
assert.equal(retried.session.id, created.session.id);
assert.equal(
  createDatabase.executedSql.filter((sql) =>
    sql.startsWith("INSERT INTO sql_erd_sessions")
  ).length,
  1
);
await assert.rejects(
  () =>
    createService.createAgentGeneratedSession(
      actorUserId,
      workspaceId,
      agentRunId,
      schemaSpec({ title: "Different input" })
    ),
  (error) => {
    assert.equal(error.getStatus(), 409);
    assert.match(error.getResponse().error.message, /agentRunId was reused/);
    return true;
  }
);

const replaceDatabase = new MutationDatabase("replace");
const replaceService = new SqlErdService(replaceDatabase, workspaceService);
const replacement = await replaceService.replaceAgentGeneratedSchema(
  actorUserId,
  workspaceId,
  sessionId,
  agentRunId,
  schemaSpec({
    title: "Ignored replacement title",
    tables: [
      schemaSpec().tables[0],
      {
        key: "orders",
        name: "orders",
        schemaName: null,
        columns: [column("id", "id", true), column("user_id", "user_id")],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      }
    ],
    relations: [
      {
        key: "orders_user",
        name: null,
        fromTableKey: "orders",
        fromColumnKeys: ["user_id"],
        toTableKey: "users",
        toColumnKeys: ["id"]
      }
    ]
  })
);
assert.equal(replacement.operation.type, "source_snapshot");
assert.equal(replacement.operation.clientOperationId, agentRunId);
assert.equal(replacement.revision, 6);
assert.equal(replacement.latestOpSeq, 3);
assert.equal(replacement.snapshot.dialect, "postgresql");
assert.equal(replaceDatabase.session.title, "Existing title");
assert.deepEqual(
  replacement.layoutJson.tableLayouts.find(
    (layout) => layout.tableId === "table.users"
  ),
  { tableId: "table.users", x: 321, y: 123, width: 300 }
);
assert.ok(
  replacement.layoutJson.tableLayouts.some(
    (layout) => layout.tableId === "table.orders"
  )
);
assert.ok(
  replaceDatabase.executedSql.some((sql) =>
    sql.startsWith("INSERT INTO sql_erd_session_operation_outbox")
  )
);

const replacementRetry = await replaceService.replaceAgentGeneratedSchema(
  actorUserId,
  workspaceId,
  sessionId,
  agentRunId,
  schemaSpec({
    title: "Ignored replacement title",
    tables: [
      schemaSpec().tables[0],
      {
        key: "orders",
        name: "orders",
        schemaName: null,
        columns: [column("id", "id", true), column("user_id", "user_id")],
        primaryKey: { name: null, columnKeys: ["id"] },
        uniqueConstraints: []
      }
    ],
    relations: [
      {
        key: "orders_user",
        name: null,
        fromTableKey: "orders",
        fromColumnKeys: ["user_id"],
        toTableKey: "users",
        toColumnKeys: ["id"]
      }
    ]
  })
);
assert.equal(replacementRetry.operation.id, replacement.operation.id);
assert.equal(
  replaceDatabase.executedSql.filter((sql) =>
    sql.startsWith("UPDATE sql_erd_sessions")
  ).length,
  1
);
assert.equal(
  replaceDatabase.executedSql.filter((sql) =>
    sql.startsWith("INSERT INTO sql_erd_session_operation_outbox")
  ).length,
  1
);
await assert.rejects(
  () =>
    replaceService.replaceAgentGeneratedSchema(
      actorUserId,
      workspaceId,
      sessionId,
      agentRunId,
      schemaSpec({ title: "Different replacement input" })
    ),
  (error) => {
    assert.equal(error.getStatus(), 409);
    assert.match(error.getResponse().error.message, /clientOperationId was reused/);
    return true;
  }
);

const lockedDatabase = new MutationDatabase("replace");
lockedDatabase.activeLock = {
  workspace_id: workspaceId,
  session_id: sessionId,
  lease_id: "77777777-7777-4777-8777-777777777777",
  actor_user_id: "88888888-8888-4888-8888-888888888888",
  source_base_revision: 5,
  expires_at: "2026-07-16T00:00:30.000Z",
  created_at: now,
  updated_at: now
};
await assert.rejects(
  () =>
    new SqlErdService(lockedDatabase, workspaceService).replaceAgentGeneratedSchema(
      actorUserId,
      workspaceId,
      sessionId,
      "99999999-9999-4999-8999-999999999999",
      schemaSpec()
    ),
  (error) => {
    assert.equal(error.getStatus(), 409);
    assert.match(error.getResponse().error.message, /source lock is currently held/);
    return true;
  }
);

const snapshotDatabase = new MutationDatabase("replace");
snapshotDatabase.session = sessionRow({ write_protocol: "snapshot" });
await assert.rejects(
  () =>
    new SqlErdService(snapshotDatabase, workspaceService).replaceAgentGeneratedSchema(
      actorUserId,
      workspaceId,
      sessionId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      schemaSpec()
    ),
  (error) => {
    assert.equal(error.getStatus(), 409);
    assert.equal(
      error.getResponse().error.code,
      "SQL_ERD_WRITE_PROTOCOL_MISMATCH"
    );
    return true;
  }
);

const dialectDatabase = new MutationDatabase("replace");
await assert.rejects(
  () =>
    new SqlErdService(dialectDatabase, workspaceService).replaceAgentGeneratedSchema(
      actorUserId,
      workspaceId,
      sessionId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      schemaSpec({ requestedDialect: "mysql" })
    ),
  (error) => {
    assert.equal(error.getStatus(), 409);
    assert.match(error.getResponse().error.message, /dialect conflicts/);
    return true;
  }
);

const autoDialectDatabase = new MutationDatabase("replace");
autoDialectDatabase.session = sessionRow({ dialect: "auto" });
const autoDialectReplacement = await new SqlErdService(
  autoDialectDatabase,
  workspaceService
).replaceAgentGeneratedSchema(
  actorUserId,
  workspaceId,
  sessionId,
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  schemaSpec({ requestedDialect: "mysql" })
);
assert.equal(autoDialectReplacement.snapshot.dialect, "auto");
assert.match(autoDialectReplacement.snapshot.sourceText, /CREATE TABLE `users`/);
assert.equal(autoDialectDatabase.session.dialect, "auto");

console.log("SQLtoERD Agent schema mutation tests passed.");
