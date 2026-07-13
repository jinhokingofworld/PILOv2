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
assert.match(createCanvas, /VALUES \(\$1, \$2, 'freeform', \$3\)/);
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

console.log("Review Canvas access tests passed.");
