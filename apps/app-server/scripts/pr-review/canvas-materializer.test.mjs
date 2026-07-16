import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildPrReviewCanvasMaterialization,
  getPrReviewCanvasShapeIndex,
  getPrReviewFileShapeId,
  getPrReviewRelationShapeId
} = require("../../dist/modules/pr-review/pr-review-canvas-materializer.js");

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_SESSION_ID = "33333333-3333-4333-8333-333333333333";

function file(index, overrides = {}) {
  return {
    reviewFileId: `review-file-${index}`,
    roomFileId: `room-file-${index}`,
    reviewFlowFileId: `membership-${index}`,
    flowId: "flow-1",
    flowSortOrder: 1,
    workflowOrder: index,
    fileName: `file-${index}.ts`,
    filePath: `src/file-${index}.ts`,
    fileStatus: "modified",
    roleSummary: "핵심 로직",
    riskLevel: "medium",
    reviewStatus: "not_reviewed",
    ...overrides
  };
}

function relation(overrides = {}) {
  return {
    fromReviewFileId: "review-file-1",
    toReviewFileId: "review-file-2",
    fromRoomFileId: "room-file-1",
    toRoomFileId: "room-file-2",
    flowId: "flow-1",
    relationType: "depends_on",
    source: "rule",
    confidence: 90,
    reason: "호출 관계",
    ...overrides
  };
}

function asStoredShape(shape, overrides = {}) {
  return {
    id: shape.id,
    canvas_id: "canvas-1",
    parent_shape_id: shape.values.parentShapeId,
    shape_type: shape.values.shapeType,
    title: shape.values.title,
    text_content: shape.values.textContent,
    x: shape.values.x,
    y: shape.values.y,
    width: shape.values.width,
    height: shape.values.height,
    rotation: shape.values.rotation,
    z_index: shape.values.zIndex,
    raw_shape: shape.values.rawShape,
    content_hash: "hash",
    revision: 1,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    deleted_at: null,
    ...overrides
  };
}

const firstInput = {
  reviewRoomId: ROOM_ID,
  reviewSessionId: SESSION_ID,
  files: [file(1), file(2)],
  relations: [relation(), relation()],
  existingShapes: []
};
const first = await buildPrReviewCanvasMaterialization(firstInput);
const repeated = await buildPrReviewCanvasMaterialization(firstInput);

assert.deepEqual(repeated, first);
assert.equal(first.shapes.length, 3, "duplicate relations must be materialized once");
assert.equal(new Set(first.activeShapeIds).size, first.activeShapeIds.length);
assert.ok(first.activeShapeIds.includes(getPrReviewFileShapeId("room-file-1")));
assert.ok(
  first.activeShapeIds.includes(getPrReviewRelationShapeId(ROOM_ID, relation()))
);
assert.equal(getPrReviewCanvasShapeIndex(9), "a000000000091");
assert.equal(getPrReviewCanvasShapeIndex(109), "a0000000001l1");

const firstFileShape = first.shapes.find(
  (shape) => shape.id === getPrReviewFileShapeId("room-file-1")
);
const secondFileShape = first.shapes.find(
  (shape) => shape.id === getPrReviewFileShapeId("room-file-2")
);
assert.ok(firstFileShape);
assert.ok(secondFileShape);
assert.notDeepEqual(
  [firstFileShape.values.x, firstFileShape.values.y],
  [secondFileShape.values.x, secondFileShape.values.y]
);
const firstRelationShape = first.shapes.find(
  (shape) => shape.values.shapeType === "pr_review_relation_edge"
);
assert.ok(firstRelationShape);
assert.ok(firstRelationShape.values.rawShape.props.routePoints.length >= 2);

const persistedRoutePoints = [
  { x: 0, y: 20 },
  { x: 0, y: 0 },
  { x: 260, y: 0 },
  { x: 260, y: 20 }
];
const persistedRelation = asStoredShape(firstRelationShape, {
  width: 260,
  height: 20,
  raw_shape: {
    ...firstRelationShape.values.rawShape,
    props: {
      ...firstRelationShape.values.rawShape.props,
      routePoints: persistedRoutePoints,
      startX: 0,
      startY: 20,
      endX: 260,
      endY: 20
    }
  }
});
const rematerialized = await buildPrReviewCanvasMaterialization({
  ...firstInput,
  existingShapes: [
    asStoredShape(firstFileShape),
    asStoredShape(secondFileShape),
    persistedRelation
  ]
});
const preservedRelation = rematerialized.shapes.find(
  (shape) => shape.id === persistedRelation.id
);
assert.ok(preservedRelation);
assert.deepEqual(
  preservedRelation.values.rawShape.props.routePoints,
  persistedRoutePoints,
  "stored relation routes must survive later materialization"
);

const reviewOrderRelation = relation({
  relationType: "review_order",
  source: "fallback",
  reason: "Recommended review order"
});
const reviewOrderOnly = await buildPrReviewCanvasMaterialization({
  ...firstInput,
  relations: [reviewOrderRelation]
});
const reviewOrderWithSemanticSupport = await buildPrReviewCanvasMaterialization({
  ...firstInput,
  relations: [reviewOrderRelation, relation()]
});
const getFileGeometry = (result, roomFileId) => {
  const shape = result.shapes.find(
    (candidate) => candidate.id === getPrReviewFileShapeId(roomFileId)
  );
  return [shape.values.x, shape.values.y];
};

assert.deepEqual(
  getFileGeometry(reviewOrderWithSemanticSupport, "room-file-1"),
  getFileGeometry(reviewOrderOnly, "room-file-1"),
  "semantic relations must not change the primary review-order layout"
);
assert.deepEqual(
  getFileGeometry(reviewOrderWithSemanticSupport, "room-file-2"),
  getFileGeometry(reviewOrderOnly, "room-file-2"),
  "semantic relations must not change the primary review-order layout"
);

const flowOneFirst = file(1, { workflowOrder: 1 });
const flowOneSecond = file(2, { workflowOrder: 2 });
const flowOneThird = file(3, { workflowOrder: 3 });
const flowTwoFirst = file(4, {
  flowId: "flow-2",
  flowSortOrder: 2,
  workflowOrder: 1
});
const flowTwoSecond = file(5, {
  flowId: "flow-2",
  flowSortOrder: 2,
  workflowOrder: 2
});
const adjacentOrder = relation({
  relationType: "review_order",
  source: "fallback",
  reason: "Review the next file",
  fromReviewFileId: flowOneFirst.reviewFileId,
  toReviewFileId: flowOneSecond.reviewFileId,
  fromRoomFileId: flowOneFirst.roomFileId,
  toRoomFileId: flowOneSecond.roomFileId
});
const sameFlowSemantic = relation({
  relationType: "depends_on",
  source: "rule",
  reason: "Supporting dependency",
  fromReviewFileId: flowOneFirst.reviewFileId,
  toReviewFileId: flowOneThird.reviewFileId,
  fromRoomFileId: flowOneFirst.roomFileId,
  toRoomFileId: flowOneThird.roomFileId
});
const secondFlowOrder = relation({
  relationType: "review_order",
  source: "fallback",
  reason: "Review the next file",
  flowId: "flow-2",
  fromReviewFileId: flowTwoFirst.reviewFileId,
  toReviewFileId: flowTwoSecond.reviewFileId,
  fromRoomFileId: flowTwoFirst.roomFileId,
  toRoomFileId: flowTwoSecond.roomFileId
});
const flowLayout = await buildPrReviewCanvasMaterialization({
  reviewRoomId: ROOM_ID,
  reviewSessionId: SESSION_ID,
  files: [flowOneThird, flowTwoSecond, flowOneFirst, flowTwoFirst, flowOneSecond],
  relations: [sameFlowSemantic, adjacentOrder, secondFlowOrder],
  existingShapes: []
});
const flowOneFirstGeometry = getFileGeometry(flowLayout, flowOneFirst.roomFileId);
const flowOneSecondGeometry = getFileGeometry(flowLayout, flowOneSecond.roomFileId);
const flowOneThirdGeometry = getFileGeometry(flowLayout, flowOneThird.roomFileId);
const flowTwoFirstGeometry = getFileGeometry(flowLayout, flowTwoFirst.roomFileId);
assert.ok(flowOneFirstGeometry[0] < flowOneSecondGeometry[0]);
assert.ok(flowOneFirstGeometry[0] < flowOneThirdGeometry[0]);
assert.ok(flowTwoFirstGeometry[1] > flowOneFirstGeometry[1]);

const getRoutePoints = (relationToFind) => {
  const shape = flowLayout.shapes.find(
    (candidate) => candidate.id === getPrReviewRelationShapeId(ROOM_ID, relationToFind)
  );
  return shape.values.rawShape.props.routePoints;
};
assert.ok(getRoutePoints(adjacentOrder).length >= 2);
assert.ok(getRoutePoints(sameFlowSemantic).length >= 2);
assert.ok(
  getRoutePoints(sameFlowSemantic).some(
    (point, index, points) =>
      index > 0 && point.y !== points[index - 1].y
  ),
  "semantic edges must include an orthogonal vertical segment when needed"
);

const entryFile = file(11, {
  roomFileId: "room-file-entry",
  reviewFileId: "review-file-entry",
  workflowOrder: 1,
  roleType: "entry"
});
const coreFile = file(12, {
  roomFileId: "room-file-core",
  reviewFileId: "review-file-core",
  workflowOrder: 2,
  roleType: "core_logic"
});
const stateFile = file(13, {
  roomFileId: "room-file-state",
  reviewFileId: "review-file-state",
  workflowOrder: 3,
  roleType: "ui_state"
});
const apiFile = file(14, {
  roomFileId: "room-file-api",
  reviewFileId: "review-file-api",
  workflowOrder: 4,
  roleType: "api_contract"
});
const layeredFlow = await buildPrReviewCanvasMaterialization({
  reviewRoomId: ROOM_ID,
  reviewSessionId: SESSION_ID,
  files: [entryFile, coreFile, stateFile, apiFile],
  relations: [
    relation({
      fromReviewFileId: entryFile.reviewFileId,
      fromRoomFileId: entryFile.roomFileId,
      toReviewFileId: coreFile.reviewFileId,
      toRoomFileId: coreFile.roomFileId
    }),
    relation({
      fromReviewFileId: entryFile.reviewFileId,
      fromRoomFileId: entryFile.roomFileId,
      toReviewFileId: stateFile.reviewFileId,
      toRoomFileId: stateFile.roomFileId
    }),
    relation({
      fromReviewFileId: coreFile.reviewFileId,
      fromRoomFileId: coreFile.roomFileId,
      toReviewFileId: apiFile.reviewFileId,
      toRoomFileId: apiFile.roomFileId
    }),
    relation({
      fromReviewFileId: stateFile.reviewFileId,
      fromRoomFileId: stateFile.roomFileId,
      toReviewFileId: apiFile.reviewFileId,
      toRoomFileId: apiFile.roomFileId
    })
  ],
  existingShapes: []
});
const coreGeometry = getFileGeometry(layeredFlow, coreFile.roomFileId);
const stateGeometry = getFileGeometry(layeredFlow, stateFile.roomFileId);
assert.equal(
  coreGeometry[0],
  stateGeometry[0],
  "parallel relation targets must share a review layer"
);
assert.notEqual(
  coreGeometry[1],
  stateGeometry[1],
  "parallel relation targets must not collapse into a single review row"
);

const movedRawShape = {
  ...firstFileShape.values.rawShape,
  x: 920,
  y: 640,
  index: "a9",
  parentId: "shape:frame-1",
  props: {
    ...firstFileShape.values.rawShape.props,
    w: 340,
    h: 180
  }
};
const movedExisting = asStoredShape(firstFileShape, {
  parent_shape_id: "shape:frame-1",
  x: 920,
  y: 640,
  width: 340,
  height: 180,
  z_index: 42,
  raw_shape: movedRawShape,
  deleted_at: "2026-07-13T01:00:00.000Z"
});
const next = await buildPrReviewCanvasMaterialization({
  reviewRoomId: ROOM_ID,
  reviewSessionId: NEXT_SESSION_ID,
  files: [
    file(1, {
      reviewFileId: "next-review-file-1",
      reviewStatus: "approved"
    }),
    file(2, { reviewFileId: "next-review-file-2" }),
    file(3)
  ],
  relations: [
    relation({
      fromReviewFileId: "next-review-file-1",
      toReviewFileId: "next-review-file-2"
    })
  ],
  existingShapes: [movedExisting, asStoredShape(secondFileShape)]
});
const preserved = next.shapes.find((shape) => shape.id === movedExisting.id);
assert.ok(preserved);
assert.deepEqual(
  {
    parentShapeId: preserved.values.parentShapeId,
    x: preserved.values.x,
    y: preserved.values.y,
    width: preserved.values.width,
    height: preserved.values.height,
    zIndex: preserved.values.zIndex,
    index: preserved.values.rawShape.index
  },
  {
    parentShapeId: "shape:frame-1",
    x: 920,
    y: 640,
    width: 340,
    height: 180,
    zIndex: 42,
    index: "a9"
  }
);
assert.equal(preserved.values.rawShape.props.reviewFileId, "next-review-file-1");
assert.equal(preserved.values.rawShape.props.reviewStatus, "approved");
assert.equal(
  preserved.values.rawShape.props.currentReviewSessionId,
  NEXT_SESSION_ID
);

const newFileShape = next.shapes.find(
  (shape) => shape.id === getPrReviewFileShapeId("room-file-3")
);
assert.ok(newFileShape);
assert.notDeepEqual(
  [newFileShape.values.x, newFileShape.values.y],
  [preserved.values.x, preserved.values.y]
);

const nextRelationShape = next.shapes.find(
  (shape) => shape.values.shapeType === "pr_review_relation_edge"
);
assert.ok(nextRelationShape);
assert.equal(
  nextRelationShape.id,
  getPrReviewRelationShapeId(ROOM_ID, relation())
);
assert.equal(nextRelationShape.values.rawShape.props.fromRoomFileId, "room-file-1");
assert.equal(nextRelationShape.values.rawShape.props.toRoomFileId, "room-file-2");

const invalidLegacyIndex = asStoredShape(nextRelationShape, {
  raw_shape: {
    ...nextRelationShape.values.rawShape,
    index: "a10"
  }
});
const repaired = (await buildPrReviewCanvasMaterialization({
  ...firstInput,
  existingShapes: [invalidLegacyIndex]
})).shapes.find((shape) => shape.id === invalidLegacyIndex.id);
assert.ok(repaired);
assert.notEqual(repaired.values.rawShape.index, "a10");
assert.equal(repaired.values.rawShape.index, getPrReviewCanvasShapeIndex(0));

console.log("PR Review canvas materializer tests passed");
