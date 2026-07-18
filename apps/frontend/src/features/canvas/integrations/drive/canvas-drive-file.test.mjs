import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isCanvasDriveImageMimeType,
  isCanvasDrivePreviewMimeType,
  isCanvasDriveTextMimeType,
  normalizeCanvasDriveMimeType,
} from "./canvas-drive-file.ts";

assert.equal(normalizeCanvasDriveMimeType("Application/PDF; charset=UTF-8"), "application/pdf");
assert.equal(isCanvasDriveImageMimeType("image/png"), true);
assert.equal(isCanvasDriveTextMimeType("text/plain; charset=utf-8"), true);
assert.equal(isCanvasDrivePreviewMimeType("application/json"), true);
assert.equal(isCanvasDrivePreviewMimeType("text/html"), false);
assert.equal(isCanvasDrivePreviewMimeType("image/svg+xml"), false);

const fileNodeTypes = await readFile(
  new URL("../../engine/shapes/file-node/PiloFileNodeShapeTypes.ts", import.meta.url),
  "utf8",
);

assert.match(fileNodeTypes, /fileId: string/);
assert.match(fileNodeTypes, /fileName: string/);
assert.match(fileNodeTypes, /mimeType: string/);
assert.doesNotMatch(fileNodeTypes, /url: string/);

const fileNodeComponent = await readFile(
  new URL(
    "../../engine/shapes/file-node/PiloFileNodeComponent.tsx",
    import.meta.url,
  ),
  "utf8",
);
const pdfPreview = await readFile(
  new URL(
    "../../engine/shapes/file-node/PiloFileNodePdfPreview.tsx",
    import.meta.url,
  ),
  "utf8",
);

assert.match(fileNodeComponent, /PiloFileNodePdfPreview/);
assert.doesNotMatch(fileNodeComponent, /<iframe/);
assert.match(pdfPreview, /<Document/);
assert.match(pdfPreview, /<Page/);
assert.match(pdfPreview, /renderAnnotationLayer=\{false\}/);
assert.match(pdfPreview, /renderTextLayer=\{false\}/);
assert.match(pdfPreview, /setPageNumber/);
assert.doesNotMatch(pdfPreview, /usePdfCollaborationRoom/);
