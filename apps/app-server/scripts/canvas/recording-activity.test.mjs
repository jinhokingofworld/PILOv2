import assert from "node:assert/strict";

const { ActivityLogService } = await import(
  "../../dist/common/activity-log.service.js"
);
const { CanvasRecordingActivityService } = await import(
  "../../dist/modules/canvas/recording-activity/canvas-recording-activity.service.js"
);

const actorUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const recordingId = "33333333-3333-4333-8333-333333333333";
const canvasId = "44444444-4444-4444-8444-444444444444";
const base = {
  actorUserId,
  canvasId,
  captureId: "canvas:retry-1",
  changedFields: ["text"],
  capturedAt: "2026-07-17T10:30:00.000Z",
  operationType: "update",
  receiveSeq: 42,
  recordingId,
  shapeId: "shape:note-1",
  shapeType: "note",
  textPreview: "결정 사항",
  workspaceId,
};

async function runScenario({
  activeRecordings = [{ id: recordingId }],
  capturedAt = base.capturedAt,
  endedAt = "2026-07-17T11:00:00.000Z",
  existingLink = null,
  recordingStatus = "COMPLETED",
} = {}) {
  const executed = [];
  let linkInserted = false;
  const transaction = {
    async query(text) {
      if (text.includes("FROM meeting_recordings r")) return activeRecordings;
      return [];
    },
    async queryOne(text, values) {
      if (text.includes("SELECT r.id, r.meeting_id")) {
        return {
          id: recordingId,
          ended_at: endedAt,
          meeting_id: "55555555-5555-4555-8555-555555555555",
          started_at: "2026-07-17T10:00:00.000Z",
          status: recordingStatus,
          workspace_id: workspaceId,
        };
      }
      if (text.includes("FROM meeting_recording_activity_links")) {
        return existingLink ?? (linkInserted ? { activity_log_id: "activity-1" } : null);
      }
      if (text.includes("FROM meeting_participants")) return { id: "participant-1" };
      if (text.includes("FROM canvas")) return { id: canvasId };
      if (text.includes("FROM activity_logs")) return { id: "activity-1" };
      if (text.includes("INSERT INTO meeting_recording_activity_links")) {
        if (linkInserted) return null;
        linkInserted = true;
        return { id: "link-1" };
      }
      throw new Error(`Unexpected queryOne: ${text}`);
    },
    async execute(text, values) {
      executed.push({ text, values });
      return { rows: [] };
    },
  };
  const database = {
    async transaction(callback) {
      return callback(transaction);
    },
  };
  const service = new CanvasRecordingActivityService(
    new ActivityLogService(),
    database,
  );
  const result = await service.appendBatch({ activities: [{ ...base, capturedAt }] });
  return { executed, result, transaction };
}

const outside = await runScenario({
  capturedAt: "2026-07-17T09:59:59.999Z",
});
assert.deepEqual(outside.result, { accepted: 0 });
assert.equal(outside.executed.length, 0, "before recording must not append Activity Log");

const afterEnd = await runScenario({
  endedAt: "2026-07-17T10:30:00.000Z",
});
assert.deepEqual(afterEnd.result, { accepted: 0 });
assert.equal(afterEnd.executed.length, 0, "after recording end must not append Activity Log");

const ambiguous = await runScenario({
  activeRecordings: [{ id: recordingId }, { id: "66666666-6666-4666-8666-666666666666" }],
  endedAt: null,
  recordingStatus: "RUNNING",
});
assert.deepEqual(ambiguous.result, { accepted: 0 });
assert.equal(ambiguous.executed.length, 0, "ambiguous recording must not append Activity Log");

const first = await runScenario();
assert.deepEqual(first.result, { accepted: 1 });
assert.equal(first.executed.length, 1);
assert.match(first.executed[0].text, /INSERT INTO activity_logs/);
assert.equal(first.executed[0].values[6].includes(base.captureId), true);

const retry = await runScenario({ existingLink: { activity_log_id: "activity-1" } });
assert.deepEqual(retry.result, { accepted: 0 });
assert.equal(retry.executed.length, 0, "retry must not append a second Activity Log");

console.log("Canvas recording activity regression tests passed.");
