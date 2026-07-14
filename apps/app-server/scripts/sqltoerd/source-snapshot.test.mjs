import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("reflect-metadata");
const {
  validateSqlErdSourcePublishRequest,
  validateSqlErdSourceSnapshotBatchQuery
} = require(
  "../../dist/modules/sql-erd/sql-erd-source-snapshot.validation.js"
);
const {
  rebaseSqlErdSourceLayout
} = require("../../dist/modules/sql-erd/sql-erd-source-rebase.js");
const {
  assertSourceSnapshotBatchResponseSize,
  SqlErdService
} = require("../../dist/modules/sql-erd/sql-erd.service.js");

const migrationDirectory = new URL("../../../../db/migrations/", import.meta.url);
const migrationFilenames = await readdir(migrationDirectory);

assert.ok(
  migrationFilenames.includes("063_create_sql_erd_source_snapshots_and_locks.sql"),
  "SQLtoERD source snapshot migration must exist"
);

const migration = await readFile(
  new URL(
    "../../../../db/migrations/063_create_sql_erd_source_snapshots_and_locks.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(migration, /CREATE TABLE public\.sql_erd_session_source_snapshots/);
assert.match(migration, /UNIQUE \(workspace_id, session_id, id\)/);
assert.match(migration, /CREATE TABLE public\.sql_erd_session_source_locks/);
assert.match(migration, /FOREIGN KEY \(workspace_id, session_id, source_snapshot_id\)/);
assert.match(migration, /ON DELETE RESTRICT/);
assert.match(migration, /operation_type IN \('layout_patch', 'source_snapshot'\)/);
assert.match(migration, /source_snapshot_id IS NULL/);
assert.match(migration, /source_snapshot_id IS NOT NULL/);
assert.match(migration, /prevent_sql_erd_source_snapshot_mutation/);
assert.match(migration, /octet_length\(source_text\)/);
assert.match(migration, /3 \* 1024 \* 1024/);

const sessionId = "11111111-1111-4111-8111-111111111111";
const sourcePublishRequest = {
  baseRevision: 1,
  clientOperationId: "source-publish-1",
  dialect: "postgresql",
  leaseId: "22222222-2222-4222-8222-222222222222",
  modelJson: { version: 1, schema: { relations: [], tables: [] } },
  sourceFormat: "sql",
  sourceText: "CREATE TABLE users (id bigint primary key);"
};

assert.deepEqual(validateSqlErdSourcePublishRequest(sourcePublishRequest), sourcePublishRequest);
assert.deepEqual(
  validateSqlErdSourceSnapshotBatchQuery({
    ids: `${sessionId},${sessionId},22222222-2222-4222-8222-222222222222`
  }),
  { ids: [sessionId, "22222222-2222-4222-8222-222222222222"] }
);

assert.throws(
  () => validateSqlErdSourcePublishRequest({ ...sourcePublishRequest, layoutJson: {} }),
  (error) => error.getStatus() === 400 && /unknown field/.test(error.getResponse().error.message)
);
assert.throws(
  () =>
    validateSqlErdSourceSnapshotBatchQuery({
      ids: [sessionId, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"].join(",")
    }),
  (error) => error.getStatus() === 400 && /between 1 and 3/.test(error.getResponse().error.message)
);
assert.throws(
  () => validateSqlErdSourceSnapshotBatchQuery({ ids: "x".repeat(2049) }),
  (error) => error.getStatus() === 400 && /too long/.test(error.getResponse().error.message)
);

const escapedMegabyte = "\\".repeat(1024 * 1024);
assert.throws(
  () =>
    assertSourceSnapshotBatchResponseSize(
      Array.from({ length: 3 }, (_, index) => ({
        id: `snapshot-${index}`,
        sourceText: escapedMegabyte,
        modelJson: { escaped: escapedMegabyte },
        layoutJson: { escaped: escapedMegabyte }
      }))
    ),
  (error) => error.getStatus() === 413 && error.getResponse().error.code === "PAYLOAD_TOO_LARGE"
);

const table = (id, name, columns = []) => ({
  id,
  name,
  schemaName: null,
  columns,
  constraints: [],
  comment: null
});

const nextModel = {
  version: 1,
  schema: {
    relations: [],
    tables: [
      table("table.users", "users"),
      table("table.orders", "orders"),
      table("table.projects", "projects")
    ]
  }
};

const currentLayout = {
  version: 1,
  tableLayouts: [
    { tableId: "table.users", x: 80, y: 80, width: 320 },
    { tableId: "table.removed", x: 440, y: 80, width: 320 }
  ],
  viewport: { x: 10, y: 20, zoom: 1.2 },
  annotations: {
    version: 1,
    links: [
      {
        id: "link.keep",
        kind: "table_link",
        fromTableId: "table.users",
        toTableId: "table.projects",
        label: ""
      },
      {
        id: "link.remove",
        kind: "table_link",
        fromTableId: "table.users",
        toTableId: "table.removed",
        label: ""
      }
    ],
    notes: [{ id: "note.keep", x: 1, y: 2, width: 180, height: 120, text: "keep" }],
    frames: [
      {
        id: "frame.keep",
        x: 1,
        y: 2,
        width: 300,
        height: 200,
        title: "keep",
        color: "blue",
        isLocked: false
      }
    ],
    texts: [
      {
        id: "text.keep",
        x: 1,
        y: 2,
        width: 100,
        height: 40,
        text: "keep",
        color: "slate"
      }
    ],
    strokes: [
      {
        id: "stroke.keep",
        points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        color: "slate",
        size: 2
      }
    ]
  }
};

const rebased = rebaseSqlErdSourceLayout({ currentLayout, nextModel });
assert.deepEqual(
  rebased.layoutJson.tableLayouts.map((layout) => layout.tableId),
  ["table.users", "table.orders", "table.projects"]
);
assert.equal(rebased.layoutJson.tableLayouts[0].x, 80);
assert.equal(rebased.layoutJson.tableLayouts[1].x, 544);
assert.equal(rebased.layoutJson.tableLayouts[2].x, 1008);
assert.deepEqual(rebased.layoutJson.viewport, currentLayout.viewport);
assert.deepEqual(rebased.layoutJson.annotations.notes, currentLayout.annotations.notes);
assert.deepEqual(rebased.layoutJson.annotations.frames, currentLayout.annotations.frames);
assert.deepEqual(rebased.layoutJson.annotations.texts, currentLayout.annotations.texts);
assert.deepEqual(rebased.layoutJson.annotations.strokes, currentLayout.annotations.strokes);
assert.deepEqual(rebased.layoutJson.annotations.links.map((link) => link.id), ["link.keep"]);
assert.deepEqual(rebased.summary, {
  createdTableLayoutIds: ["table.orders", "table.projects"],
  removedAnnotationLinkIds: ["link.remove"],
  removedTableLayoutIds: ["table.removed"]
});

class SourceSnapshotDatabase {
  constructor() {
    this.lock = null;
    this.operation = null;
    this.outboxOperationId = null;
    this.snapshot = null;
    this.session = {
      id: sessionId,
      workspace_id: "55555555-5555-4555-8555-555555555555",
      title: "Source publish",
      source_format: "sql",
      dialect: "postgresql",
      source_text: "CREATE TABLE users ();",
      model_json: {
        version: 1,
        schema: { relations: [], tables: [table("table.users", "users")] }
      },
      layout_json: {
        version: 1,
        tableLayouts: [{ tableId: "table.users", x: 80, y: 80 }]
      },
      settings_json: {},
      table_count: 1,
      relation_count: 0,
      revision: 2,
      write_protocol: "operations_v1",
      latest_op_seq: 0,
      created_by: "66666666-6666-4666-8666-666666666666",
      updated_by: "66666666-6666-4666-8666-666666666666",
      created_at: new Date("2026-07-15T00:00:00.000Z"),
      updated_at: new Date("2026-07-15T00:00:00.000Z"),
      deleted_at: null
    };
  }

  async transaction(callback) {
    return callback(this);
  }

  async query() {
    return [];
  }

  async execute(text, values = []) {
    if (text.includes("INSERT INTO sql_erd_session_operation_outbox")) {
      this.outboxOperationId = values[0];
    }
    if (text.includes("DELETE FROM sql_erd_session_source_locks")) {
      this.lock = null;
    }
    if (text.includes("UPDATE sql_erd_session_source_locks") && this.lock) {
      this.lock.source_base_revision = values.at(-1);
    }
    return { rowCount: 1, rows: [] };
  }

  async queryOne(text, values = []) {
    if (text.includes("FROM sql_erd_sessions")) return this.session;
    if (text.includes("FROM sql_erd_session_source_locks")) return this.lock;
    if (text.includes("INSERT INTO sql_erd_session_source_locks")) {
      this.lock = {
        workspace_id: values[0],
        session_id: values[1],
        lease_id: values[2],
        actor_user_id: values[3],
        source_base_revision: values[4],
        expires_at: new Date(Date.now() + 30_000),
        created_at: new Date(),
        updated_at: new Date()
      };
      return this.lock;
    }
    if (text.includes("UPDATE sql_erd_sessions")) {
      this.session = {
        ...this.session,
        source_format: values[2],
        dialect: values[3],
        source_text: values[4],
        model_json: JSON.parse(values[5]),
        layout_json: JSON.parse(values[6]),
        table_count: values[7],
        relation_count: values[8],
        updated_by: values[9],
        revision: Number(this.session.revision) + 1,
        latest_op_seq: Number(this.session.latest_op_seq) + 1
      };
      return this.session;
    }
    if (text.includes("INSERT INTO sql_erd_session_source_snapshots")) {
      this.snapshot = {
        id: "77777777-7777-4777-8777-777777777777",
        workspace_id: values[0],
        session_id: values[1],
        source_format: values[2],
        dialect: values[3],
        source_text: values[4],
        model_json: JSON.parse(values[5]),
        layout_json: JSON.parse(values[6]),
        table_count: values[7],
        relation_count: values[8],
        base_revision: values[9],
        result_revision: values[10],
        created_by: values[11],
        created_at: new Date("2026-07-15T00:01:00.000Z")
      };
      return this.snapshot;
    }
    if (text.includes("FROM sql_erd_session_source_snapshots")) return this.snapshot;
    if (text.includes("FROM sql_erd_session_operations")) return this.operation;
    if (text.includes("INSERT INTO sql_erd_session_operations")) {
      this.operation = {
        id: "88888888-8888-4888-8888-888888888888",
        workspace_id: values[0],
        session_id: values[1],
        actor_user_id: values[2],
        operation_type: "source_snapshot",
        op_seq: values[3],
        client_operation_id: values[4],
        base_revision: values[5],
        applied_on_revision: values[6],
        result_revision: values[7],
        payload: JSON.parse(values[8]),
        source_snapshot_id: values[9],
        request_fingerprint: values[10],
        created_at: new Date("2026-07-15T00:01:00.000Z")
      };
      return this.operation;
    }
    return null;
  }
}

const sourceWorkspaceId = "55555555-5555-4555-8555-555555555555";
const sourceUserId = "66666666-6666-4666-8666-666666666666";
const sourceLeaseId = "99999999-9999-4999-8999-999999999999";
const sourceDatabase = new SourceSnapshotDatabase();
const sourceService = new SqlErdService(sourceDatabase, {
  async assertWorkspaceAccess() {
    return { id: sourceWorkspaceId };
  }
});

const acquiredLock = await sourceService.acquireSourceLock(
  sourceUserId,
  sourceWorkspaceId,
  sessionId,
  { leaseId: sourceLeaseId }
);
assert.equal(acquiredLock.leaseId, sourceLeaseId);
assert.equal(acquiredLock.sourceBaseRevision, 2);

const sourcePublish = await sourceService.publishSourceSnapshot(
  sourceUserId,
  sourceWorkspaceId,
  sessionId,
  {
    baseRevision: 2,
    clientOperationId: "source-publish-1",
    dialect: "postgresql",
    leaseId: sourceLeaseId,
    modelJson: nextModel,
    sourceFormat: "sql",
    sourceText: "CREATE TABLE users (); CREATE TABLE orders (); CREATE TABLE projects ();"
  }
);
assert.equal(sourcePublish.operation.type, "source_snapshot");
assert.equal(sourcePublish.snapshot.id, "77777777-7777-4777-8777-777777777777");
assert.equal(sourcePublish.revision, 3);
assert.equal(sourceDatabase.outboxOperationId, sourcePublish.operation.id);
assert.equal(sourceDatabase.lock.source_base_revision, 3);

const retry = await sourceService.publishSourceSnapshot(
  sourceUserId,
  sourceWorkspaceId,
  sessionId,
  {
    baseRevision: 2,
    clientOperationId: "source-publish-1",
    dialect: "postgresql",
    leaseId: sourceLeaseId,
    modelJson: nextModel,
    sourceFormat: "sql",
    sourceText: "CREATE TABLE users (); CREATE TABLE orders (); CREATE TABLE projects ();"
  }
);
assert.equal(retry.operation.id, sourcePublish.operation.id);
assert.equal(sourceDatabase.session.revision, 3);

await assert.rejects(
  () =>
    sourceService.publishSourceSnapshot(sourceUserId, sourceWorkspaceId, sessionId, {
      baseRevision: 3,
      clientOperationId: "source-publish-1",
      dialect: "postgresql",
      leaseId: sourceLeaseId,
      modelJson: nextModel,
      sourceFormat: "sql",
      sourceText: "changed input"
    }),
  (error) => error.getStatus() === 409 && error.getResponse().error.code === "CONFLICT"
);
