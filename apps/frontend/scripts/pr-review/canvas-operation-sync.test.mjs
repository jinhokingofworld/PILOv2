import assert from "node:assert/strict";

const { reconcilePrReviewCanvasOperations } = await import(
  "../../src/features/pr-review/realtime/pr-review-canvas-operation-sync.ts"
);

function operation(opSeq) {
  return {
    id: `operation-${opSeq}`,
    workspaceId: "workspace-1",
    canvasId: "canvas-1",
    shapeId: "shape-1",
    operationType: "update",
    opSeq,
    actorUserId: "user-1",
    clientOperationId: `client-operation-${opSeq}`,
    baseRevision: opSeq - 1,
    resultRevision: opSeq,
    contentHash: `hash-${opSeq}`,
    payload: {},
    createdAt: "2026-07-14T00:00:00.000Z"
  };
}

assert.deepEqual(
  reconcilePrReviewCanvasOperations(2, [
    operation(5),
    operation(3),
    operation(4),
    operation(3)
  ]),
  {
    contiguousOperations: [operation(3), operation(4), operation(5)],
    lastSeenOpSeq: 5,
    pendingOperations: []
  }
);

assert.deepEqual(reconcilePrReviewCanvasOperations(2, [operation(5)]), {
  contiguousOperations: [],
  lastSeenOpSeq: 2,
  pendingOperations: [operation(5)]
});

assert.deepEqual(
  reconcilePrReviewCanvasOperations(4, [operation(3), operation(4)]),
  {
    contiguousOperations: [],
    lastSeenOpSeq: 4,
    pendingOperations: []
  }
);

console.log("PR Review Canvas operation sync tests passed");
