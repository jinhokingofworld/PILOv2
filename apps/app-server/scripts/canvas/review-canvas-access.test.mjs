import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const canvasAccessService = await readFile(
  new URL(
    "../../src/modules/canvas/policies/canvas-access.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasBoardService = await readFile(
  new URL(
    "../../src/modules/canvas/board/canvas-board.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeCommandService = await readFile(
  new URL(
    "../../src/modules/canvas/shape/canvas-shape-command.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeQueryService = await readFile(
  new URL(
    "../../src/modules/canvas/shape/canvas-shape-query.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasOperationQueryService = await readFile(
  new URL(
    "../../src/modules/canvas/operation/canvas-operation-query.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasUserStateService = await readFile(
  new URL(
    "../../src/modules/canvas/user-state/canvas-user-state.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasService = [
  canvasAccessService,
  canvasBoardService,
  canvasOperationQueryService,
  canvasShapeCommandService,
  canvasShapeQueryService,
  canvasUserStateService
].join("\n");
const canvasAgentRepository = await readFile(
  new URL(
    "../../src/modules/canvas/agent/canvas-agent.repository.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeValidation = await readFile(
  new URL(
    "../../src/modules/canvas/shape/canvas-shape.validation.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeMapper = await readFile(
  new URL(
    "../../src/modules/canvas/shape/canvas-shape.mapper.ts",
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
  const end = nextMethodName
    ? source.indexOf(`  async ${nextMethodName}(`, start + 1)
    : source.length;

  assert.notEqual(start, -1, `${methodName} must exist`);
  if (nextMethodName) {
    assert.notEqual(end, -1, `${nextMethodName} must follow ${methodName}`);
  }

  return source.slice(start, end);
}

const listCanvases = readMethod(
  canvasBoardService,
  "listCanvases",
  "createCanvas"
);
const createCanvas = readMethod(
  canvasBoardService,
  "createCanvas",
  "getCanvas"
);
const getCanvas = readMethod(
  canvasBoardService,
  "getCanvas",
  "updateViewSetting"
);
const listShapes = readMethod(
  canvasShapeQueryService,
  "listShapesInViewport",
  "getShapeDetail"
);
const listOperations = readMethod(
  canvasOperationQueryService,
  "listOperationsAfterSeq",
  undefined
);
const createShape = readMethod(
  canvasShapeCommandService,
  "createShape",
  "syncShapesBatch"
);
const syncShapes = readMethod(
  canvasShapeCommandService,
  "syncShapesBatch",
  "updateShape"
);
const enterCanvas = readMethod(
  canvasUserStateService,
  "enterCanvas",
  "leaveCanvas"
);
const leaveCanvas = readMethod(
  canvasUserStateService,
  "leaveCanvas",
  undefined
);
const updateViewSetting = readMethod(
  canvasBoardService,
  "updateViewSetting",
  undefined
);

assert.match(canvasService, /const CANVAS_READ_ACCESS_SQL = `[\s\S]*pr_review_rooms/);
assert.match(
  canvasService,
  /const CANVAS_WRITE_ACCESS_SQL = `[\s\S]*review_room\.status = 'active'/
);
assert.match(listCanvases, /c\.board_type = 'freeform'/);
assert.match(listCanvases, /c\.engine_type = 'classic'/);
assert.doesNotMatch(listCanvases, /CANVAS_READ_ACCESS_SQL/);
assert.match(canvasService, /c\.engine_type = 'classic'/);
assert.match(createCanvas, /VALUES \(\$1, \$2, 'freeform', \$3\)/);
assert.match(
  getCanvas,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId\s*\)/
);
assert.match(
  listShapes,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId\s*\)/
);
assert.match(listOperations, /CANVAS_READ_ACCESS_SQL/);
assert.match(
  createShape,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId,\s*"write"\s*\)/
);
assert.match(
  syncShapes,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId,\s*"write"\s*\)/
);
assert.match(
  enterCanvas,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId\s*\)/
);
assert.match(
  leaveCanvas,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId\s*\)/
);
assert.match(
  updateViewSetting,
  /canvasAccess\.findCanvas\(\s*workspaceId,\s*canvasId,\s*"write"\s*\)/
);
assert.match(updateViewSetting, /CANVAS_WRITE_ACCESS_SQL/);
assert.match(canvasShapeQueryService, /getShapeDetail[\s\S]*CANVAS_READ_ACCESS_SQL/);
assert.match(
  canvasShapeCommandService,
  /updateShape[\s\S]*CANVAS_WRITE_ACCESS_SQL/
);
assert.match(
  canvasShapeCommandService,
  /deleteShape[\s\S]*CANVAS_WRITE_ACCESS_SQL/
);
assert.match(
  canvasShapeCommandService,
  /writeShapeOperation[\s\S]*CANVAS_WRITE_ACCESS_SQL/
);
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
