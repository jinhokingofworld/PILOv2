import assert from "node:assert/strict";

import {
  readSqlErdTableMoveClearPayload,
  readSqlErdTableMovePreviewPayload,
} from "../../dist/sql-erd/sql-erd-table-move-payload.js";

const room = {
  sessionId: "session-1",
  workspaceId: "workspace-1",
};

assert.deepEqual(
  readSqlErdTableMovePreviewPayload({
    ...room,
    dragId: " drag-1 ",
    tableId: " table.orders ",
    x: 12.5,
    y: -3,
  }),
  {
    ...room,
    dragId: "drag-1",
    tableId: "table.orders",
    x: 12.5,
    y: -3,
  },
);
assert.equal(
  readSqlErdTableMovePreviewPayload({
    ...room,
    dragId: "drag-1",
    tableId: "table.orders",
    x: Number.NaN,
    y: 0,
  }),
  null,
);
assert.equal(
  readSqlErdTableMovePreviewPayload({
    ...room,
    dragId: "",
    tableId: "table.orders",
    x: 0,
    y: 0,
  }),
  null,
);
assert.equal(
  readSqlErdTableMovePreviewPayload({
    ...room,
    tableId: "",
    x: 0,
    y: 0,
  }),
  null,
);
assert.deepEqual(
  readSqlErdTableMoveClearPayload({
    ...room,
    tableIds: ["table.orders", "table.orders", " table.users "],
  }),
  {
    ...room,
    tableIds: ["table.orders", "table.users"],
  },
);
assert.equal(readSqlErdTableMoveClearPayload({ ...room, tableIds: [] }), null);
assert.equal(
  readSqlErdTableMoveClearPayload({
    ...room,
    tableIds: Array.from({ length: 101 }, (_, index) => `table.${index}`),
  }),
  null,
);

console.log("SQLtoERD table move payload tests passed");
