import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const canvasService = await readFile(
  new URL("../../src/modules/canvas/canvas.service.ts", import.meta.url),
  "utf8"
);
const canvasAgentRepository = await readFile(
  new URL(
    "../../src/modules/canvas/agent/canvas-agent.repository.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeValidation = await readFile(
  new URL(
    "../../src/modules/canvas/canvas-shape.validation.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeMapper = await readFile(
  new URL(
    "../../src/modules/canvas/canvas-shape.mapper.ts",
    import.meta.url
  ),
  "utf8"
);
const customShapeMigration = await readFile(
  new URL(
    "../../../../db/migrations/051_add_pr_review_canvas_shape_types.sql",
    import.meta.url
  ),
  "utf8"
);
const {
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
  assertUserCanCreateCanvasShape,
  assertUserCanDeleteCanvasShape,
  prepareUserCanvasShapeUpdate
} = await import(
  "../../dist/modules/canvas/canvas-review-shape-policy.js"
);

function readMethod(source, methodName, nextMethodName) {
  const start = source.indexOf(`  async ${methodName}(`);
  const end = source.indexOf(`  async ${nextMethodName}(`, start + 1);

  assert.notEqual(start, -1, `${methodName} must exist`);
  assert.notEqual(end, -1, `${nextMethodName} must follow ${methodName}`);

  return source.slice(start, end);
}

const listCanvases = readMethod(canvasService, "listCanvases", "createCanvas");
const createCanvas = readMethod(canvasService, "createCanvas", "getCanvas");
const getCanvas = readMethod(canvasService, "getCanvas", "listShapesInViewport");
const listShapes = readMethod(
  canvasService,
  "listShapesInViewport",
  "listOperationsAfterSeq"
);
const listOperations = readMethod(
  canvasService,
  "listOperationsAfterSeq",
  "createShape"
);
const createShape = readMethod(canvasService, "createShape", "syncShapesBatch");
const syncShapes = readMethod(
  canvasService,
  "syncShapesBatch",
  "getShapeDetail"
);
const enterCanvas = readMethod(canvasService, "enterCanvas", "leaveCanvas");
const leaveCanvas = readMethod(canvasService, "leaveCanvas", "updateViewSetting");
const updateViewSetting = readMethod(
  canvasService,
  "updateViewSetting",
  "updateShape"
);

assert.match(canvasService, /const CANVAS_READ_ACCESS_SQL = `[\s\S]*pr_review_rooms/);
assert.match(
  canvasService,
  /const CANVAS_WRITE_ACCESS_SQL = `[\s\S]*review_room\.status = 'active'/
);
assert.match(listCanvases, /c\.board_type = 'freeform'/);
assert.doesNotMatch(listCanvases, /CANVAS_READ_ACCESS_SQL/);
assert.match(createCanvas, /engine_type/);
assert.match(createCanvas, /engine_version/);
assert.match(createCanvas, /VALUES \(\$1, \$2, 'freeform', \$3, 1, \$4\)/);
assert.match(getCanvas, /findCanvas\(workspaceId, canvasId\)/);
assert.match(listShapes, /findCanvas\(workspaceId, canvasId\)/);
assert.match(listOperations, /CANVAS_READ_ACCESS_SQL/);
assert.match(createShape, /findCanvas\(workspaceId, canvasId, "write"\)/);
assert.match(syncShapes, /findCanvas\(workspaceId, canvasId, "write"\)/);
assert.match(enterCanvas, /findCanvas\(workspaceId, canvasId\)/);
assert.match(leaveCanvas, /findCanvas\(workspaceId, canvasId\)/);
assert.match(updateViewSetting, /findCanvas\(workspaceId, canvasId, "write"\)/);
assert.match(updateViewSetting, /CANVAS_WRITE_ACCESS_SQL/);
assert.match(canvasService, /getShapeDetail[\s\S]*CANVAS_READ_ACCESS_SQL/);
assert.match(canvasService, /updateShape[\s\S]*CANVAS_WRITE_ACCESS_SQL/);
assert.match(canvasService, /deleteShape[\s\S]*CANVAS_WRITE_ACCESS_SQL/);
assert.match(canvasService, /writeShapeOperation[\s\S]*CANVAS_WRITE_ACCESS_SQL/);
assert.match(canvasAgentRepository, /board_type = 'freeform'/);
assert.match(canvasShapeValidation, /PR_REVIEW_FILE_NODE_SHAPE_TYPE/);
assert.match(canvasShapeValidation, /PR_REVIEW_RELATION_EDGE_SHAPE_TYPE/);
assert.match(
  canvasShapeMapper,
  /values\.parentShapeId === undefined[\s\S]*currentShape\.parent_shape_id[\s\S]*values\.parentShapeId/
);
assert.match(customShapeMigration, /'pr_review_file_node'/);
assert.match(customShapeMigration, /'pr_review_relation_edge'/);

const fileNode = createShapeRow(PR_REVIEW_FILE_NODE_SHAPE_TYPE, {
  id: "shape:review-file-1",
  index: "a1",
  parentId: "page:page",
  props: {
    fileName: "canvas.service.ts",
    reviewFileId: "review-file-1",
    reviewRoomId: "review-room-1",
    riskLevel: "high",
    w: 272,
    h: 116
  },
  type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  typeName: "shape",
  x: 120,
  y: 80
});
const relationEdge = createShapeRow(PR_REVIEW_RELATION_EDGE_SHAPE_TYPE, {
  id: "shape:review-relation-1",
  props: {
    fromRoomFileId: "room-file-1",
    toRoomFileId: "room-file-2"
  },
  type: PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
  typeName: "shape"
});

assert.doesNotThrow(() => assertUserCanCreateCanvasShape("note"));
assertForbidden(() =>
  assertUserCanCreateCanvasShape(PR_REVIEW_FILE_NODE_SHAPE_TYPE)
);
assertForbidden(() =>
  assertUserCanCreateCanvasShape(PR_REVIEW_RELATION_EDGE_SHAPE_TYPE)
);
const permittedFileNodeUpdate = prepareUserCanvasShapeUpdate(fileNode, {
  height: 140,
  parentShapeId: "shape:group-1",
  rawShape: {
    ...fileNode.raw_shape,
    index: "a2",
    parentId: "shape:group-1",
    props: {
      ...fileNode.raw_shape.props,
      h: 140,
      w: 320
    },
    x: 240,
    y: 160
  },
  shapeType: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  textContent: fileNode.text_content,
  title: fileNode.title,
  width: 320,
  x: 240,
  y: 160,
  zIndex: 2
});
assert.equal(permittedFileNodeUpdate.rawShape.x, 240);
assert.equal(permittedFileNodeUpdate.rawShape.y, 160);
assert.equal(permittedFileNodeUpdate.rawShape.parentId, "shape:group-1");
assert.equal(permittedFileNodeUpdate.rawShape.props.w, 320);
assert.equal(permittedFileNodeUpdate.rawShape.props.h, 140);
assert.equal(
  permittedFileNodeUpdate.rawShape.props.fileName,
  "canvas.service.ts"
);
assert.equal(
  permittedFileNodeUpdate.rawShape.props.reviewRoomId,
  "review-room-1"
);
assertForbidden(() =>
  prepareUserCanvasShapeUpdate(fileNode, {
    rawShape: {
      ...fileNode.raw_shape,
      props: {
        ...fileNode.raw_shape.props,
        fileName: "tampered.ts"
      }
    }
  })
);
assertForbidden(() =>
  prepareUserCanvasShapeUpdate(relationEdge, { x: 400 })
);
assertForbidden(() =>
  prepareUserCanvasShapeUpdate(createShapeRow("note", {}), {
    shapeType: PR_REVIEW_FILE_NODE_SHAPE_TYPE
  })
);
assertForbidden(() => assertUserCanDeleteCanvasShape(fileNode));
assertForbidden(() => assertUserCanDeleteCanvasShape(relationEdge));
assert.doesNotThrow(() =>
  assertUserCanDeleteCanvasShape(createShapeRow("note", {}))
);

console.log("Review Canvas access tests passed.");

function createShapeRow(shapeType, rawShape) {
  return {
    canvas_id: "canvas-1",
    content_hash: "hash",
    created_at: new Date(0),
    deleted_at: null,
    height: 116,
    id: `shape:${shapeType}`,
    parent_shape_id: null,
    raw_shape: rawShape,
    revision: 1,
    rotation: 0,
    shape_type: shapeType,
    text_content: null,
    title: shapeType,
    updated_at: new Date(0),
    width: 272,
    x: 120,
    y: 80,
    z_index: 1
  };
}

function assertForbidden(callback) {
  assert.throws(callback, (error) => error?.getStatus?.() === 403);
}
