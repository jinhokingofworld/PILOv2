import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Agent thread PostgreSQL test");
}

const require = createRequire(import.meta.url);
const { AgentLoggingService } = require(
  "../../dist/modules/agent/agent-logging.service.js"
);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
const workspaceId = randomUUID();
const userId = randomUUID();

const database = {
  async queryOne(text, values = []) {
    const result = await client.query(text, values);
    return result.rows[0] ?? null;
  },
  async execute(text, values = []) {
    return client.query(text, values);
  },
  async transaction(callback) {
    return callback(database);
  }
};

const workspaceService = {
  async assertWorkspaceAccess() {}
};
const service = new AgentLoggingService(database, workspaceService);

async function resetTables() {
  await client.query(
    "TRUNCATE agent_confirmations, agent_run_outbox, agent_logs, agent_runs, agent_threads"
  );
}

async function insertThread(lastActivityAt) {
  const threadId = randomUUID();
  await client.query(
    `INSERT INTO agent_threads (
       id, workspace_id, requested_by_user_id, last_activity_at, expires_at
     )
     VALUES ($1, $2, $3, $4, now() + INTERVAL '30 days')`,
    [threadId, workspaceId, userId, lastActivityAt]
  );
  return threadId;
}

async function threadIdFor(runId) {
  const result = await client.query("SELECT thread_id FROM agent_runs WHERE id = $1", [runId]);
  return result.rows[0]?.thread_id ?? null;
}

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE agent_threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      requested_by_user_id uuid NOT NULL,
      last_activity_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days')
    )
  `);
  await client.query(`
    CREATE TEMP TABLE agent_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      requested_by_user_id uuid NOT NULL,
      thread_id uuid,
      client_request_id text,
      request_context_json jsonb,
      status text NOT NULL DEFAULT 'planning',
      risk_level text,
      prompt text NOT NULL,
      timezone text NOT NULL,
      message text,
      final_answer text,
      error_code text,
      error_message text,
      expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX ux_agent_runs_client_request_test
    ON agent_runs (workspace_id, requested_by_user_id, client_request_id)
    WHERE client_request_id IS NOT NULL
  `);
  await client.query(
    "CREATE TEMP TABLE agent_confirmations (run_id uuid, status text, expires_at timestamptz)"
  );
  await client.query(`
    CREATE TEMP TABLE agent_logs (
      workspace_id uuid,
      run_id uuid,
      step_id uuid,
      confirmation_id uuid,
      actor_type text,
      actor_user_id uuid,
      level text,
      event_type text,
      message text,
      metadata_json jsonb,
      resource_refs jsonb
    )
  `);
  await client.query(
    "CREATE TEMP TABLE agent_run_outbox (run_id uuid, workspace_id uuid)"
  );

  await resetTables();
  const staleThreadId = await insertThread(new Date(Date.now() - 61 * 60 * 1000));
  const staleResult = await service.createRun(userId, workspaceId, { prompt: "새 대화" });
  assert.notEqual(await threadIdFor(staleResult.run.id), staleThreadId);

  await resetTables();
  const recentThreadId = await insertThread(new Date());
  const recentResult = await service.createRun(userId, workspaceId, { prompt: "독립 요청" });
  assert.equal(await threadIdFor(recentResult.run.id), recentThreadId);

  await resetTables();
  const pendingThreadId = await insertThread(new Date());
  const pendingRunId = randomUUID();
  await client.query(
    `INSERT INTO agent_runs (id, workspace_id, requested_by_user_id, thread_id, prompt, timezone)
     VALUES ($1, $2, $3, $4, '승인 대기 요청', 'Asia/Seoul')`,
    [pendingRunId, workspaceId, userId, pendingThreadId]
  );
  await client.query(
    `INSERT INTO agent_confirmations (run_id, status, expires_at)
     VALUES ($1, 'pending', now() + INTERVAL '10 minutes')`,
    [pendingRunId]
  );
  const pendingResult = await service.createRun(userId, workspaceId, { prompt: "승인 전 후속 요청" });
  assert.equal(await threadIdFor(pendingResult.run.id), pendingThreadId);

  await client.query("ROLLBACK");
  console.log("Agent thread PostgreSQL policy test passed");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
