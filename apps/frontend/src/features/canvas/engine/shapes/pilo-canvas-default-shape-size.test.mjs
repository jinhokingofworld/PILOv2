import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const instantShape = readSource("../interactions/pilo-canvas-instant-shape.ts");
const shapeFactory = readSource("./pilo-canvas-shape-factory.ts");
const codeBlockTypes = readSource("./code-block/PiloCodeBlockShapeTypes.ts");
const fileNodeTypes = readSource("./file-node/PiloFileNodeShapeTypes.ts");
const canvasEditor = readSource("../editor/CanvasEditor.tsx");

assert.match(instantShape, /frame: \{ height: 360, width: 640 \}/);
assert.match(instantShape, /note: \{ height: 400, width: 400 \}/);
assert.match(instantShape, /text: \{ height: 96, width: 360 \}/);
assert.match(instantShape, /"circle"\) return \{ height: 240, width: 240 \}/);
assert.match(instantShape, /return \{ height: 220, width: 360 \}/);
assert.match(instantShape, /return \{ height: 180, width: 360 \}/);
assert.match(instantShape, /return \{ height: 220, width: 320 \}/);
assert.match(instantShape, /return \{ height: 240, width: 280 \}/);
assert.match(instantShape, /return \{ height: 240, width: 240 \}/);

assert.match(shapeFactory, /PILO_IMPORTED_CODE_BLOCK_WIDTH = 920/);
assert.match(shapeFactory, /PILO_IMPORTED_CODE_BLOCK_HEIGHT = 600/);
assert.match(shapeFactory, /PILO_IMPORTED_CODE_FOLDER_GAP_X = 112/);
assert.match(shapeFactory, /PILO_IMPORTED_CODE_FOLDER_GAP_Y = 128/);
assert.match(shapeFactory, /PILO_IMPORTED_CODE_FOLDER_PADDING = 80/);
assert.match(shapeFactory, /PILO_IMPORTED_CODE_FOLDER_HEADER_HEIGHT = 104/);
assert.equal(
  shapeFactory.match(/const width = 840;\s+const height = 520;/g)?.length,
  2,
);
assert.match(shapeFactory, /const width = 640;\s+const height = 400;/);
assert.match(shapeFactory, /const width = 720;\s+const height = 440;/);
assert.match(shapeFactory, /const width = 640;\s+const height = 320;/);
assert.match(shapeFactory, /const width = 840;\s+const height = 560;/);

assert.match(codeBlockTypes, /PILO_COLLAPSED_CODE_BLOCK_SIZE = \{\s+h: 144,\s+w: 360/);
assert.match(codeBlockTypes, /DEFAULT_PILO_CODE_BLOCK_PROPS[\s\S]*w: 840,\s+h: 520/);
assert.match(fileNodeTypes, /DEFAULT_PILO_FILE_NODE_PROPS[\s\S]*w: 840,\s+h: 560/);
assert.match(canvasEditor, /PILO_CODE_IMPORT_GRID_GAP_X = 112/);
assert.match(canvasEditor, /PILO_CODE_IMPORT_GRID_GAP_Y = 128/);
