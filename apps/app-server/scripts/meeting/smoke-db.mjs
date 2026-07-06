import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for meeting DB smoke test");
}

const require = createRequire(import.meta.url);
const { MeetingService } = require("../../dist/modules/meeting/meeting.service.js");
const { WorkspaceService } = require(
  "../../dist/modules/workspace/workspace.service.js"
);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? {
          rejectUnauthorized: false
        }
      : undefined
});

const client = await pool.connect();

function createTransactionDatabase(targetClient) {
  const database = {
    async query(text, values = []) {
      const result = await this.execute(text, values);
      return result.rows;
    },
    async queryOne(text, values = []) {
      const rows = await this.query(text, values);
      return rows[0] ?? null;
    },
    execute(text, values = []) {
      return targetClient.query(text, [...values]);
    },
    transaction(callback) {
      return callback(database);
    }
  };

  return database;
}

const liveKitTokenService = {
  async createJoinToken(input) {
    return {
      livekitRoomName: input.livekitRoomName,
      livekitIdentity: input.livekitIdentity,
      livekitToken: `smoke-token-${input.livekitIdentity}`,
      livekitUrl: "wss://livekit.example.test",
      expiresAt: "2026-07-05T01:00:00.000Z"
    };
  }
};

const suffix = randomUUID();
const currentUserId = randomUUID();
const workspaceId = randomUUID();

try {
  await client.query("BEGIN");

  const database = createTransactionDatabase(client);
  const workspaceService = new WorkspaceService(database);
  const meetingService = new MeetingService(
    database,
    workspaceService,
    liveKitTokenService
  );

  await database.execute(
    `
      INSERT INTO users (id, name, email, google_user_id)
      VALUES ($1, $2, $3, $4)
    `,
    [
      currentUserId,
      "Meeting smoke user",
      `meeting-smoke-${suffix}@example.com`,
      `meeting-smoke-${suffix}`
    ]
  );

  await database.execute(
    `
      INSERT INTO workspaces (id, name, owner_user_id)
      VALUES ($1, $2, $3)
    `,
    [workspaceId, "Meeting smoke workspace", currentUserId]
  );

  const emptyCurrent = await meetingService.getCurrentMeeting(
    currentUserId,
    workspaceId
  );
  assert.deepEqual(emptyCurrent, {
    meeting: null,
    currentRecording: null,
    activeParticipantCount: 0
  });

  const started = await meetingService.startMeeting(currentUserId, workspaceId, {});
  assert.equal(started.meeting.workspaceId, workspaceId);
  assert.equal(started.participant.userId, currentUserId);
  assert.equal(started.participant.isActive, true);
  assert.equal(started.livekit.livekitRoomName, started.meeting.livekitRoomName);
  assert.equal(started.livekit.livekitIdentity, started.participant.livekitIdentity);
  assert.equal(started.currentRecording, null);

  const rejoined = await meetingService.joinMeeting(
    currentUserId,
    workspaceId,
    started.meeting.id
  );
  assert.equal(rejoined.meeting.id, started.meeting.id);
  assert.equal(rejoined.participant.id, started.participant.id);
  assert.equal(rejoined.participant.isActive, true);
  assert.equal(rejoined.livekit.livekitRoomName, started.meeting.livekitRoomName);

  const left = await meetingService.leaveMeeting(
    currentUserId,
    workspaceId,
    started.meeting.id
  );
  assert.equal(left.participant.id, started.participant.id);
  assert.equal(left.participant.isActive, false);
  assert.equal(left.meetingEnded, true);
  assert.equal(typeof left.meeting.endedAt, "string");

  await assert.rejects(
    () => meetingService.joinMeeting(currentUserId, workspaceId, started.meeting.id),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      return true;
    }
  );

  await client.query("ROLLBACK");
  console.log("meeting DB smoke passed");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
