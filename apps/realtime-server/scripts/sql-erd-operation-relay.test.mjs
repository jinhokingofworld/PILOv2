import assert from "node:assert/strict";

const { relaySqlErdOperation } = await import(
  "../dist/sql-erd/sql-erd-operation-relay.js"
);

const validPayload = {
  id: "operation-1",
  workspaceId: "workspace-1",
  sessionId: "session-1",
  actorUserId: "user-1",
  type: "layout_patch",
  opSeq: 7,
  clientOperationId: "client-operation-1",
  baseRevision: 3,
  appliedOnRevision: 4,
  resultRevision: 5,
  rebased: true,
  patch: { annotations: { notes: { deleteIds: ["note-1"] } } },
  createdAt: "2026-07-14T12:00:00.000Z"
};

const emitted = [];
assert.equal(
  relaySqlErdOperation(validPayload, (roomName, event, payload) => {
    emitted.push({ event, payload, roomName });
  }),
  true
);
assert.deepEqual(emitted, [
  {
    roomName: "workspace:workspace-1:sql-erd:session-1",
    event: "sql-erd:operation",
    payload: validPayload
  }
]);

assert.equal(
  relaySqlErdOperation({ ...validPayload, opSeq: 0 }, () => {
    throw new Error("invalid payload must not emit");
  }),
  false
);

const sourceSnapshotPayload = {
  ...validPayload,
  id: "operation-2",
  type: "source_snapshot",
  sourceSnapshotId: "snapshot-1"
};
delete sourceSnapshotPayload.patch;

assert.equal(
  relaySqlErdOperation(sourceSnapshotPayload, (roomName, event, payload) => {
    emitted.push({ event, payload, roomName });
  }),
  true
);
assert.deepEqual(emitted.at(-1), {
  roomName: "workspace:workspace-1:sql-erd:session-1",
  event: "sql-erd:operation",
  payload: sourceSnapshotPayload
});
assert.equal(
  relaySqlErdOperation({ ...sourceSnapshotPayload, sourceSnapshotId: "" }, () => {
    throw new Error("invalid source snapshot payload must not emit");
  }),
  false
);
