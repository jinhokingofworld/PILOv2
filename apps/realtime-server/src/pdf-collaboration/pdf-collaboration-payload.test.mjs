import assert from "node:assert/strict";
import test from "node:test";

import { readPdfCollaborationStrokeCommit } from "../../dist/pdf-collaboration/pdf-collaboration-payload.js";

const room = {
  fileId: "00000000-0000-0000-0000-000000000002",
  workspaceId: "00000000-0000-0000-0000-000000000001"
};

test("preserves an allowed stroke color and width", () => {
  assert.deepEqual(
    readPdfCollaborationStrokeCommit({
      ...room,
      color: "#2563eb",
      id: "stroke-color-width",
      pageNumber: 1,
      points: [{ xRatio: 0.1, yRatio: 0.2 }],
      tool: "pen",
      width: 1.2
    }),
    {
      ...room,
      color: "#2563eb",
      id: "stroke-color-width",
      pageNumber: 1,
      points: [{ xRatio: 0.1, yRatio: 0.2 }],
      tool: "pen",
      width: 1.2
    }
  );
});

test("uses the existing tool defaults when older clients omit style fields", () => {
  assert.deepEqual(
    readPdfCollaborationStrokeCommit({
      ...room,
      id: "stroke-default-style",
      pageNumber: 1,
      points: [{ xRatio: 0.1, yRatio: 0.2 }],
      tool: "highlighter"
    }),
    {
      ...room,
      color: "#facc15",
      id: "stroke-default-style",
      pageNumber: 1,
      points: [{ xRatio: 0.1, yRatio: 0.2 }],
      tool: "highlighter",
      width: 2.8
    }
  );
});
