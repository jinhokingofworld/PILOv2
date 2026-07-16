import assert from "node:assert/strict";
import test from "node:test";

import roomStateModule from "../../dist/canvas/canvas-room-state.service.js";

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
