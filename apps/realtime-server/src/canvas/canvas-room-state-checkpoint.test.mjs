import assert from "node:assert/strict";
import test from "node:test";

import checkpointModule from "../../dist/canvas/checkpoint/canvas-room-checkpoint.service.js";
import roomStateModule from "../../dist/canvas/state/canvas-room-state.service.js";

const { createCanvasRoomCheckpointService } = checkpointModule;
const { createCanvasRoomStateService } = roomStateModule;

const room = {
  canvasId: "canvas-checkpoint-test",
  workspaceId: "workspace-checkpoint-test",
};

function createNote(text) {
  return {
    id: "shape:checkpoint-note",
    parentId: "page:page",
    props: {
      h: 120,
      richText: {
        content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
        type: "doc",
      },
      w: 240,
    },
    rotation: 0,
    type: "note",
    x: 100,
    y: 100,
  };
}

test("checkpoint 실행 중 발생한 최신 변경은 이전 성공 응답이 dirty에서 제거하지 않는다", () => {
  const service = createCanvasRoomStateService();

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("first")],
  });
  const firstCheckpoint = service.getCheckpointSnapshot(room);

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("latest")],
  });
  const secondCheckpoint = service.getCheckpointSnapshot(room);

  assert.notEqual(
    firstCheckpoint.operations[0]?.clientOperationId,
    secondCheckpoint.operations[0]?.clientOperationId,
  );

  service.markCheckpointSucceeded(
    room,
    firstCheckpoint.operations,
    {
      data: {
        shapes: [
          {
            contentHash: "persisted-first",
            id: "shape:checkpoint-note",
            revision: 1,
          },
        ],
      },
      success: true,
    },
    { advanceCheckpoint: true },
  );

  assert.deepEqual(service.getDirtyShapeIds(room), ["shape:checkpoint-note"]);
  assert.equal(service.getCheckpointState(room).checkpointVersion, 0);

  const latestCheckpoint = service.getCheckpointSnapshot(room);

  assert.equal(latestCheckpoint.operations[0]?.type, "update");
  service.markCheckpointSucceeded(
    room,
    latestCheckpoint.operations,
    {
      data: {
        shapes: [
          {
            contentHash: "persisted-latest",
            id: "shape:checkpoint-note",
            revision: 2,
          },
        ],
      },
      success: true,
    },
    { advanceCheckpoint: true },
  );

  assert.deepEqual(service.getDirtyShapeIds(room), []);
  assert.equal(service.getCheckpointState(room).checkpointVersion, 1);
});

test("already missing delete checkpoint clears its tombstone", async () => {
  const originalFetch = globalThis.fetch;
  const checkpointStatuses = [];
  const service = createCanvasRoomStateService();
  const shape = {
    ...createNote("deleted"),
    revision: 1,
  };

  service.recordLoadedViewport(
    room,
    { height: 600, margin: 200, width: 800, x: 0, y: 0 },
    [shape],
  );
  service.applyShapePatch(room, {
    deletedShapeIds: [shape.id],
    upsertShapes: [],
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Canvas shape not found",
        },
        success: false,
      }),
      {
        headers: { "content-type": "application/json" },
        status: 404,
      },
    );

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      onCheckpointStatus(status) {
        checkpointStatuses.push(status);
      },
      roomStateService: service,
    });

    await checkpointService.flushCheckpointNow(
      room,
      "test-token",
      "test-user",
    );

    assert.deepEqual(service.getDirtyShapeIds(room), []);
    assert.deepEqual(service.getDeletedTombstones(room), []);
    assert.equal(checkpointStatuses.at(-1)?.status, "saved");
    assert.equal(checkpointStatuses.at(-1)?.pendingOperations, 0);

    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("revoked user checkpoint authorization is discarded without dropping dirty operations", async () => {
  const originalFetch = globalThis.fetch;
  const service = createCanvasRoomStateService();
  let fetchCalls = 0;

  service.applyShapePatch(room, {
    deletedShapeIds: [],
    upsertShapes: [createNote("pending")],
  });
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("revoked authorization must not reach the App Server");
  };

  try {
    const checkpointService = createCanvasRoomCheckpointService({
      appServerUrl: "https://app-server.test",
      roomStateService: service,
    });

    checkpointService.scheduleCheckpoint(
      room,
      "revoked-token",
      "revoked-user",
    );
    checkpointService.revokeRoomAuthorization(room, "revoked-user");
    await checkpointService.flushCheckpointNow(room);

    assert.equal(fetchCalls, 0);
    assert.deepEqual(service.getDirtyShapeIds(room), ["shape:checkpoint-note"]);

    await checkpointService.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
