import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Agent message lifecycle PostgreSQL test");
}

const require = createRequire(import.meta.url);
const { AgentMessageService } = require(
  "../../dist/modules/agent/agent-message.service.js"
);
const { AgentLoggingService } = require(
  "../../dist/modules/agent/agent-logging.service.js"
);

process.env.AGENT_MESSAGE_ROUTING_MODE = "intent";

const schema = `agent_message_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schema}"`;
const adminPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  options: `-c search_path=${schema},public`
});

class ScopedDatabase {
  async query(text, values = []) {
    return (await pool.query(text, values)).rows;
  }

  async queryOne(text, values = []) {
    return (await pool.query(text, values)).rows[0] ?? null;
  }

  async execute(text, values = []) {
    return pool.query(text, values);
  }

  async transaction(callback) {
    const client = await pool.connect();
    const transaction = {
      async query(text, values = []) {
        return (await client.query(text, values)).rows;
      },
      async queryOne(text, values = []) {
        return (await client.query(text, values)).rows[0] ?? null;
      },
      async execute(text, values = []) {
        return client.query(text, values);
      }
    };
    try {
      await client.query("BEGIN");
      const result = await callback(transaction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

class SqlAgentFacade {
  normalizeCreateRunBody(body) {
    return {
      prompt: body.prompt.trim(),
      timezone: body.timezone ?? "Asia/Seoul",
      clientRequestId: body.clientRequestId,
      requestContext: body.requestContext ?? null
    };
  }

  normalizeRunInputBody(body) {
    return body;
  }

  async assertRequestContextAccess() {}

  async isDeterministicCandidateContinuationInTransaction() {
    return false;
  }

  async resumeRunInputInTransaction(
    transaction,
    currentUserId,
    workspaceId,
    runId,
    input
  ) {
    const resumed = await transaction.queryOne(
      `UPDATE agent_runs
       SET status = 'planning', message = '추가 정보를 반영하고 있습니다.', updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND requested_by_user_id = $3
         AND status = 'waiting_user_input'
       RETURNING id`,
      [runId, workspaceId, currentUserId]
    );
    if (!resumed) return "expired";
    await transaction.execute(
      `INSERT INTO agent_run_messages (run_id, sequence, role, content)
       SELECT $1, COALESCE(MAX(sequence), 0) + 1, 'user', $2
       FROM agent_run_messages WHERE run_id = $1`,
      [runId, input.message]
    );
    await transaction.execute(
      `UPDATE agent_run_outbox
       SET status = 'pending', turn_sequence = turn_sequence + 1, reason = 'user_input'
       WHERE run_id = $1`,
      [runId]
    );
    return "accepted";
  }

  async getRun(_currentUserId, _workspaceId, runId) {
    const run = await database.queryOne("SELECT * FROM agent_runs WHERE id = $1", [
      runId
    ]);
    if (!run) throw new Error("Agent run not found in PostgreSQL test");
    return {
      run: {
        id: run.id,
        workspaceId: run.workspace_id,
        requestedByUserId: run.requested_by_user_id,
        clientRequestId: run.client_request_id,
        requestContext: run.request_context_json,
        status: run.status,
        riskLevel: run.risk_level,
        prompt: run.prompt,
        timezone: run.timezone,
        message: run.message,
        finalAnswer: run.final_answer,
        errorCode: run.error_code,
        errorMessage: run.error_message,
        expiresAt: new Date(run.expires_at).toISOString(),
        completedAt: run.completed_at
          ? new Date(run.completed_at).toISOString()
          : null,
        createdAt: new Date(run.created_at).toISOString(),
        updatedAt: new Date(run.updated_at).toISOString(),
        messages: [],
        steps: [],
        confirmation: null
      }
    };
  }
}

class FixedRelationshipService {
  constructor(decision = {}) {
    this.decision = {
      relationship: "new_intent",
      confidence: "high",
      reason: "PostgreSQL lifecycle test",
      clarificationQuestion: null,
      ...decision
    };
  }

  async classify() {
    return this.decision;
  }
}

class DeferredRelationshipService extends FixedRelationshipService {
  constructor(decision) {
    super(decision);
    this.entered = new Promise((resolve) => {
      this.resolveEntered = resolve;
    });
    this.release = new Promise((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  async classify() {
    this.resolveEntered();
    await this.release;
    return this.decision;
  }
}

class TwoCallBarrierRelationshipService extends FixedRelationshipService {
  constructor() {
    super();
    this.calls = 0;
    this.barrier = new Promise((resolve) => {
      this.resolveBarrier = resolve;
    });
  }

  async classify() {
    this.calls += 1;
    if (this.calls === 2) this.resolveBarrier();
    await this.barrier;
    return this.decision;
  }
}

const database = new ScopedDatabase();
const workspaceService = { async assertWorkspaceAccess() {} };
const agentService = new SqlAgentFacade();
const loggingService = new AgentLoggingService(database, workspaceService);

function createService(relationshipService, publisher = null) {
  return new AgentMessageService(
    database,
    workspaceService,
    agentService,
    loggingService,
    relationshipService,
    publisher ?? { async publishCreatedRun() {} }
  );
}

function request(runId, clientRequestId, message = "이번 주 일정 보여줘") {
  return {
    message,
    timezone: "Asia/Seoul",
    clientRequestId,
    activeRunId: runId,
    requestContext: null,
    disposition: "auto"
  };
}

function routingCode(error) {
  return error?.getResponse?.().error?.code;
}

async function createTables() {
  await pool.query(`
    CREATE TABLE agent_threads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      requested_by_user_id uuid NOT NULL,
      last_activity_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      requested_by_user_id uuid,
      thread_id uuid,
      client_request_id text,
      request_context_json jsonb,
      status text NOT NULL DEFAULT 'planning',
      risk_level text,
      prompt text NOT NULL,
      timezone text NOT NULL DEFAULT 'Asia/Seoul',
      message text,
      final_answer text,
      error_code text,
      error_message text,
      expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '30 days'),
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      execution_lease_token uuid,
      execution_lease_generation integer NOT NULL DEFAULT 0,
      execution_lease_expires_at timestamptz,
      execution_heartbeat_at timestamptz
    );
    CREATE UNIQUE INDEX ux_agent_runs_client_request_test
      ON agent_runs (workspace_id, requested_by_user_id, client_request_id)
      WHERE client_request_id IS NOT NULL AND requested_by_user_id IS NOT NULL;
    CREATE TABLE agent_confirmations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      tool_name text NOT NULL DEFAULT 'test_write',
      status text NOT NULL DEFAULT 'pending',
      risk_level text NOT NULL DEFAULT 'medium',
      summary text NOT NULL DEFAULT 'test confirmation',
      plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      expires_at timestamptz NOT NULL,
      approved_by_user_id uuid,
      approved_at timestamptz,
      rejected_by_user_id uuid,
      rejected_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_candidate_selections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      requested_by_user_id uuid NOT NULL,
      resource_type text NOT NULL DEFAULT 'meeting_report',
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL,
      status text NOT NULL,
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_run_outbox (
      run_id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      claim_token uuid,
      claimed_at timestamptz,
      error_code text,
      error_message text,
      turn_sequence integer NOT NULL DEFAULT 1,
      reason text NOT NULL DEFAULT 'run_created',
      planning_started_at timestamptz
    );
    CREATE TABLE agent_run_messages (
      run_id uuid NOT NULL,
      sequence integer NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      PRIMARY KEY (run_id, sequence)
    );
    CREATE TABLE agent_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      run_id uuid NOT NULL,
      step_id uuid,
      confirmation_id uuid,
      actor_type text NOT NULL,
      actor_user_id uuid,
      level text NOT NULL,
      event_type text NOT NULL,
      message text NOT NULL,
      metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      resource_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function resetTables() {
  await pool.query(
    "TRUNCATE agent_logs, agent_run_messages, agent_steps, agent_candidate_selections, agent_confirmations, agent_run_outbox, agent_runs, agent_threads"
  );
}

async function seedWaitingRun({ confirmation = false, candidate = false } = {}) {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const threadId = randomUUID();
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO agent_threads (id, workspace_id, requested_by_user_id)
     VALUES ($1, $2, $3)`,
    [threadId, workspaceId, userId]
  );
  await pool.query(
    `INSERT INTO agent_runs (
       id, workspace_id, requested_by_user_id, thread_id, client_request_id,
       status, prompt, timezone, message, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 'initial-request', $5,
       '어느 회의록을 선택할까요?', 'Asia/Seoul',
       '어느 회의록을 선택할까요?', now() - INTERVAL '5 minutes',
       now() - INTERVAL '1 second'
     )`,
    [
      runId,
      workspaceId,
      userId,
      threadId,
      confirmation ? "waiting_confirmation" : "waiting_user_input"
    ]
  );
  await pool.query(
    `INSERT INTO agent_run_messages (run_id, sequence, role, content)
     VALUES ($1, 1, 'assistant', '어느 회의록을 선택할까요?')`,
    [runId]
  );
  await pool.query(
    `INSERT INTO agent_run_outbox (run_id, workspace_id, status)
     VALUES ($1, $2, 'delivered')`,
    [runId, workspaceId]
  );
  let confirmationId = null;
  if (confirmation) {
    confirmationId = randomUUID();
    await pool.query(
      `INSERT INTO agent_confirmations (id, run_id, expires_at)
       VALUES ($1, $2, now() + INTERVAL '10 minutes')`,
      [confirmationId, runId]
    );
  }
  let candidateId = null;
  if (candidate) {
    candidateId = randomUUID();
    await pool.query(
      `INSERT INTO agent_candidate_selections (
         id, run_id, workspace_id, requested_by_user_id, expires_at
       ) VALUES ($1, $2, $3, $4, now() + INTERVAL '10 minutes')`,
      [candidateId, runId, workspaceId, userId]
    );
  }
  return { workspaceId, userId, threadId, runId, confirmationId, candidateId };
}

try {
  await createTables();

  await resetTables();
  {
    const fixture = await seedWaitingRun();
    const service = createService(new FixedRelationshipService());
    const input = request(fixture.runId, "duplicate-postgres-request");
    const [first, second] = await Promise.all([
      service.routeMessage(fixture.userId, fixture.workspaceId, input),
      service.routeMessage(fixture.userId, fixture.workspaceId, input)
    ]);
    assert.equal(first.run.id, second.run.id);
    assert.equal(
      Number(
        (
          await database.queryOne(
            "SELECT COUNT(*) AS count FROM agent_runs WHERE client_request_id = $1",
            [input.clientRequestId]
          )
        ).count
      ),
      1
    );
    assert.equal(
      Number(
        (
          await database.queryOne(
            "SELECT COUNT(*) AS count FROM agent_logs WHERE event_type = 'run_cancelled'"
          )
        ).count
      ),
      1
    );
  }

  await resetTables();
  {
    const fixture = await seedWaitingRun();
    const service = createService(new TwoCallBarrierRelationshipService());
    const results = await Promise.allSettled([
      service.routeMessage(
        fixture.userId,
        fixture.workspaceId,
        request(fixture.runId, "tab-one-request", "이번 주 일정 보여줘")
      ),
      service.routeMessage(
        fixture.userId,
        fixture.workspaceId,
        request(fixture.runId, "tab-two-request", "Board 이슈 보여줘")
      )
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.equal(routingCode(rejected.reason), "AGENT_MESSAGE_ROUTING_STALE");
    assert.equal(
      Number((await database.queryOne("SELECT COUNT(*) AS count FROM agent_runs")).count),
      2
    );
  }

  await resetTables();
  {
    const fixture = await seedWaitingRun();
    const relationship = new DeferredRelationshipService();
    const service = createService(relationship);
    const routed = service.routeMessage(
      fixture.userId,
      fixture.workspaceId,
      request(fixture.runId, "stale-status-postgres")
    );
    await relationship.entered;
    await pool.query(
      "UPDATE agent_runs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1",
      [fixture.runId]
    );
    relationship.resolveRelease();
    await assert.rejects(
      routed,
      (error) => routingCode(error) === "AGENT_MESSAGE_ROUTING_STALE"
    );
  }

  await resetTables();
  {
    const fixture = await seedWaitingRun({ candidate: true });
    const relationship = new DeferredRelationshipService();
    const service = createService(relationship);
    const routed = service.routeMessage(
      fixture.userId,
      fixture.workspaceId,
      request(fixture.runId, "stale-candidate-postgres")
    );
    await relationship.entered;
    await pool.query(
      "UPDATE agent_candidate_selections SET consumed_at = now() WHERE id = $1",
      [fixture.candidateId]
    );
    relationship.resolveRelease();
    await assert.rejects(
      routed,
      (error) => routingCode(error) === "AGENT_MESSAGE_ROUTING_STALE"
    );
  }

  await resetTables();
  {
    const fixture = await seedWaitingRun({ confirmation: true });
    const relationship = new DeferredRelationshipService();
    const service = createService(relationship);
    const routed = service.routeMessage(
      fixture.userId,
      fixture.workspaceId,
      request(fixture.runId, "confirmation-race-postgres")
    );
    await relationship.entered;
    await database.transaction(async (transaction) => {
      await transaction.queryOne("SELECT id FROM agent_runs WHERE id = $1 FOR UPDATE", [
        fixture.runId
      ]);
      await transaction.queryOne(
        "SELECT id FROM agent_confirmations WHERE id = $1 AND status = 'pending' FOR UPDATE",
        [fixture.confirmationId]
      );
      await transaction.execute(
        "UPDATE agent_confirmations SET status = 'approved', approved_at = now() WHERE id = $1",
        [fixture.confirmationId]
      );
      await transaction.execute(
        "UPDATE agent_runs SET status = 'running', updated_at = now() WHERE id = $1",
        [fixture.runId]
      );
    });
    relationship.resolveRelease();
    await assert.rejects(
      routed,
      (error) => routingCode(error) === "AGENT_MESSAGE_ROUTING_STALE"
    );
    assert.equal(
      (await database.queryOne("SELECT status FROM agent_confirmations WHERE id = $1", [fixture.confirmationId])).status,
      "approved"
    );
  }

  await resetTables();
  {
    const fixture = await seedWaitingRun();
    const service = createService(new FixedRelationshipService(), {
      async publishCreatedRun() {
        throw new Error("publisher wakeup failed");
      }
    });
    await assert.rejects(
      service.routeMessage(
        fixture.userId,
        fixture.workspaceId,
        request(fixture.runId, "publisher-failure-postgres")
      ),
      /publisher wakeup failed/
    );
    assert.equal(
      (await database.queryOne("SELECT status FROM agent_runs WHERE id = $1", [fixture.runId])).status,
      "cancelled"
    );
    assert.equal(
      Number(
        (
          await database.queryOne(
            "SELECT COUNT(*) AS count FROM agent_run_outbox WHERE status = 'pending'"
          )
        ).count
      ),
      1
    );
  }

  console.log("Agent message lifecycle PostgreSQL concurrency tests passed");
} finally {
  await pool.end();
  await adminPool.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
  await adminPool.end();
}
