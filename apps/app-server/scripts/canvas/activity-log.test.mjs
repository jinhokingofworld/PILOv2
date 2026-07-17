import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { ActivityLogService } = await import(
  "../../dist/common/activity-log.service.js"
);
const { buildCanvasShapeActivityLog } = await import(
  "../../dist/modules/canvas/canvas-activity-log.js"
);

const activityLogServiceSource = await readFile(
  new URL("../../src/common/activity-log.service.ts", import.meta.url),
  "utf8"
);
const canvasServiceSource = await readFile(
  new URL(
    "../../src/modules/canvas/shape/canvas-shape-command.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasAgentServiceSource = await readFile(
  new URL(
    "../../src/modules/canvas/agent/canvas-agent.service.ts",
    import.meta.url
  ),
  "utf8"
);
const activityLogMigration = await readFile(
  new URL(
    "../../../../db/migrations/065_add_activity_log_dedupe_key.sql",
    import.meta.url
  ),
  "utf8"
);

const note = createShape({
  id: "shape:note-1",
  shapeType: "note",
  textContent: "회의에서 결정한 내용"
});
const noteCreate = buildCanvasShapeActivityLog({
  actorType: "user",
  after: note,
  operation: createOperation("create", note.id)
});

assert.equal(noteCreate?.action, "canvas_shape_created");
assert.equal(noteCreate?.actor.type, "user");
assert.equal(noteCreate?.target.id, note.id);
assert.equal(
  noteCreate?.dedupeKey,
  "canvas:canvas_shape_created:shape:note-1:operation-create"
);
assert.equal(noteCreate?.metadata.version, 1);
assert.equal(noteCreate?.metadata.data.textPreview, "회의에서 결정한 내용");
assert.doesNotMatch(JSON.stringify(noteCreate?.metadata), /rawShape/);

assert.equal(
  buildCanvasShapeActivityLog({
    actorType: "user",
    after: createShape({ shapeType: "draw" }),
    operation: createOperation("create", "shape:draw-1")
  }),
  null
);

assert.equal(
  buildCanvasShapeActivityLog({
    actorType: "user",
    before: note,
    after: { ...note, x: note.x + 100, width: 480 },
    operation: createOperation("update", note.id)
  }),
  null
);

const noteUpdate = buildCanvasShapeActivityLog({
  actorType: "user",
  before: note,
  after: { ...note, textContent: "수정된 결정 사항" },
  operation: createOperation("update", note.id)
});

assert.equal(noteUpdate?.action, "canvas_shape_updated");
assert.deepEqual(noteUpdate?.metadata.data.changedFields, ["text"]);
assert.equal(noteUpdate?.metadata.data.textPreview, "수정된 결정 사항");

const codeBefore = createShape({
  id: "shape:code-1",
  rawShape: { props: { code: "const token = 'secret';", language: "ts" } },
  shapeType: "pilo-code-block",
  textContent: "const token = 'secret';"
});
const codeUpdate = buildCanvasShapeActivityLog({
  actorType: "agent",
  before: codeBefore,
  after: {
    ...codeBefore,
    rawShape: { props: { code: "const token = 'secret';", language: "tsx" } }
  },
  operation: createOperation("update", codeBefore.id)
});

assert.equal(codeUpdate?.actor.type, "agent");
assert.deepEqual(codeUpdate?.metadata.data.changedFields, ["language"]);
assert.equal(codeUpdate?.metadata.data.language, "tsx");
assert.equal(codeUpdate?.metadata.data.textPreview, undefined);
assert.doesNotMatch(JSON.stringify(codeUpdate?.metadata), /const token/);

const sensitiveNoteCreate = buildCanvasShapeActivityLog({
  actorType: "user",
  after: createShape({ textContent: "Bearer secret-access-token-value" }),
  operation: createOperation("create", "shape:secret-note")
});
assert.equal(sensitiveNoteCreate?.metadata.data.textPreview, undefined);

const arrowDelete = buildCanvasShapeActivityLog({
  actorType: "user",
  before: createShape({ id: "shape:arrow-1", shapeType: "arrow" }),
  operation: createOperation("delete", "shape:arrow-1")
});
assert.equal(arrowDelete?.action, "canvas_shape_deleted");

const executed = [];
await new ActivityLogService().append(
  {
    execute: async (text, values) => {
      executed.push({ text, values });
      return { rows: [] };
    }
  },
  noteCreate
);

assert.equal(executed.length, 1);
assert.match(executed[0].text, /INSERT INTO activity_logs/);
assert.match(
  executed[0].text,
  /ON CONFLICT \(workspace_id, dedupe_key\) DO NOTHING/
);
assert.doesNotMatch(executed[0].text, /occurred_at/);
assert.equal(executed[0].values[6], noteCreate.dedupeKey);

assert.match(activityLogServiceSource, /append\(\s*transaction: DatabaseTransaction/);
assert.match(canvasServiceSource, /activityLogService\.append\(transaction/);
assert.match(canvasServiceSource, /if \(!writeResult\.isNewOperation\)/);
assert.match(
  canvasAgentServiceSource,
  /this\.drafts\.toShapeBatch\(draft\.draft_spec_json, clientOperationId\),\s*"agent"/,
);
assert.doesNotMatch(canvasAgentServiceSource, /result\.shapeBatch/);
assert.match(activityLogMigration, /ADD COLUMN dedupe_key TEXT/);
assert.match(activityLogMigration, /SET dedupe_key = 'legacy:' \|\| id::text/);
assert.match(activityLogMigration, /ALTER COLUMN dedupe_key SET NOT NULL/);
assert.match(
  activityLogMigration,
  /ON public\.activity_logs\(workspace_id, dedupe_key\)/
);

console.log("Canvas Activity Log tests passed.");

function createShape(overrides = {}) {
  return {
    actorUserId: "user-1",
    canvasId: "canvas-1",
    childShapeCount: 0,
    clientOperationId: "client-operation-1",
    contentHash: "hash",
    createdAt: new Date(0).toISOString(),
    deletedAt: null,
    height: 120,
    id: "shape:note-1",
    opSeq: 1,
    operationType: "create",
    parentShapeId: null,
    rawShape: {},
    revision: 1,
    rotation: 0,
    shapeType: "note",
    textContent: null,
    title: "결정 사항",
    updatedAt: new Date(0).toISOString(),
    width: 240,
    x: 100,
    y: 100,
    zIndex: 1,
    ...overrides
  };
}

function createOperation(operationType, shapeId) {
  return {
    actorUserId: "user-1",
    baseRevision: null,
    canvasId: "canvas-1",
    clientOperationId: `client-${operationType}`,
    contentHash: "hash",
    createdAt: new Date(0).toISOString(),
    id: `operation-${operationType}`,
    operationType,
    opSeq: 1,
    payload: {},
    resultRevision: 1,
    shapeId,
    workspaceId: "workspace-1"
  };
}
