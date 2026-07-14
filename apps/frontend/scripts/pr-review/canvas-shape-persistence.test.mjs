import assert from "node:assert/strict";

const {
  applyPrReviewFileShapeUpdate,
  buildPrReviewFileShapeUpdateInput,
  buildPrReviewRelationEdgeGeometry,
  getPrReviewFileShapeGeometryKey,
  readPrReviewCanvasOperationShape
} = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-canvas-persistence.ts"
);

const storedShape = {
  id: "shape:pr-review-file:room-file-1",
  canvasId: "canvas-1",
  parentShapeId: null,
  shapeType: "pr_review_file_node",
  title: "service.ts",
  textContent: "src/service.ts",
  x: 120,
  y: 80,
  width: 272,
  height: 116,
  rotation: 0,
  zIndex: 10,
  rawShape: {
    id: "shape:pr-review-file:room-file-1",
    type: "pr_review_file_node",
    x: 120,
    y: 80,
    index: "a1",
    parentId: "page:page",
    props: {
      w: 272,
      h: 116,
      roomFileId: "room-file-1",
      reviewStatus: "not_reviewed"
    }
  },
  contentHash: "hash-1",
  revision: 3
};
const currentShape = {
  id: storedShape.id,
  parentId: "page:page",
  x: 420,
  y: 260,
  index: "a7",
  props: { w: 272, h: 116, reviewStatus: "approved" }
};
const input = buildPrReviewFileShapeUpdateInput(
  storedShape,
  currentShape,
  "operation-1"
);

assert.deepEqual(input, {
  parentShapeId: null,
  x: 420,
  y: 260,
  width: 272,
  height: 116,
  zIndex: 10,
  rawShape: {
    id: "shape:pr-review-file:room-file-1",
    type: "pr_review_file_node",
    x: 420,
    y: 260,
    index: "a7",
    props: {
      w: 272,
      h: 116,
      roomFileId: "room-file-1",
      reviewStatus: "not_reviewed"
    }
  },
  baseRevision: 3,
  clientOperationId: "operation-1"
});
assert.equal(
  getPrReviewFileShapeGeometryKey(currentShape),
  "page:page\u0000420\u0000260\u0000a7\u0000272\u0000116"
);
assert.equal(applyPrReviewFileShapeUpdate(storedShape, input, 4).revision, 4);

const remoteShape = {
  ...storedShape,
  x: 640,
  y: 360,
  revision: 5,
  contentHash: "hash-5"
};
const remoteOperation = {
  id: "operation-5",
  workspaceId: "workspace-1",
  canvasId: "canvas-1",
  shapeId: storedShape.id,
  operationType: "update",
  opSeq: 5,
  actorUserId: "remote-user",
  clientOperationId: "remote-operation-5",
  baseRevision: 4,
  resultRevision: 5,
  contentHash: "hash-5",
  payload: { shape: remoteShape },
  createdAt: "2026-07-14T00:00:00.000Z"
};

assert.deepEqual(readPrReviewCanvasOperationShape(remoteOperation), remoteShape);
assert.equal(
  readPrReviewCanvasOperationShape({
    ...remoteOperation,
    payload: { shape: { ...remoteShape, shapeType: "note" } }
  }),
  null
);

assert.deepEqual(
  buildPrReviewRelationEdgeGeometry(
    { x: 100, y: 100, width: 200, height: 100 },
    { x: 500, y: 140, width: 200, height: 100 }
  ),
  {
    x: 300,
    y: 150,
    width: 200,
    height: 40,
    startX: 0,
    startY: 0,
    endX: 200,
    endY: 40
  }
);

console.log("PR Review Canvas Shape persistence tests passed");
