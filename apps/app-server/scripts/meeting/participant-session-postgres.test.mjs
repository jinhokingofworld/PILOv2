import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for participant session PostgreSQL test");
}

const require = createRequire(import.meta.url);
const { MeetingService } = require(
  "../../dist/modules/meeting/meeting.service.js"
);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const meetingId = "11111111-1111-1111-1111-111111111111";
const userId = "22222222-2222-2222-2222-222222222222";

const executor = {
  async queryOne(text, values = []) {
    const result = await client.query(text, values);
    return result.rows[0] ?? null;
  }
};

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE users (
      id uuid PRIMARY KEY,
      name text,
      avatar_url text
    )
  `);
  await client.query(`
    CREATE TEMP TABLE meeting_participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      meeting_id uuid NOT NULL,
      user_id uuid NOT NULL,
      livekit_identity text NOT NULL,
      joined_at timestamptz NOT NULL DEFAULT now(),
      left_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    "INSERT INTO users (id, name) VALUES ($1, $2)",
    [userId, "Participant session test user"]
  );

  const service = new MeetingService();
  const firstParticipant = await service.upsertParticipant(
    executor,
    meetingId,
    userId
  );
  const activeParticipant = await service.upsertParticipant(
    executor,
    meetingId,
    userId
  );

  assert.equal(firstParticipant.meeting_id, meetingId);
  assert.equal(firstParticipant.user_id, userId);
  assert.equal(firstParticipant.left_at, null);
  assert.equal(activeParticipant.id, firstParticipant.id);
  assert.equal(activeParticipant.left_at, null);

  await client.query("ROLLBACK");
  console.log("participant session PostgreSQL test passed");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
