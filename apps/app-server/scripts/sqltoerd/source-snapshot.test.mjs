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

const migrationDirectory = new URL("../../../../db/migrations/", import.meta.url);
const migrationFilenames = await readdir(migrationDirectory);

assert.ok(
  migrationFilenames.includes("062_create_sql_erd_source_snapshots_and_locks.sql"),
  "SQLtoERD source snapshot migration must exist"
);

const migration = await readFile(
  new URL(
    "../../../../db/migrations/062_create_sql_erd_source_snapshots_and_locks.sql",
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
