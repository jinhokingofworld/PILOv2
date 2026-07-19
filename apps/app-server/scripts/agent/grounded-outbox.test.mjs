import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentGroundedAnswerOutboxPublisherService } = require(
  "../../dist/modules/agent/agent-grounded-answer-outbox-publisher.service.js"
);

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const OUTBOX_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_TOKEN = "55555555-5555-4555-8555-555555555555";

class FakeDatabase {
  constructor({ claim = null, staleRows = [], terminalRun = null } = {}) {
    this.claim = claim;
    this.staleRows = staleRows;
    this.terminalRun = terminalRun;
    this.calls = [];
  }

  async query(text, values) {
    this.calls.push({ method: "query", text, values });
    if (text.includes("WITH candidates AS")) return this.staleRows;
    if (text.includes("SELECT outbox.run_id")) return [];
    throw new Error(`Unhandled query: ${text}`);
  }

  async queryOne(text, values) {
    this.calls.push({ method: "queryOne", text, values });
    if (text.includes("UPDATE agent_grounded_answer_outbox AS outbox")) {
      return this.claim;
    }
    if (
      text.includes("UPDATE agent_grounded_answer_outbox") &&
      text.includes("RETURNING run_id, workspace_id")
    ) {
      return { run_id: RUN_ID, workspace_id: WORKSPACE_ID };
    }
    if (text.includes("UPDATE agent_runs")) return this.terminalRun;
    throw new Error(`Unhandled queryOne: ${text}`);
  }

  async execute(text, values) {
    this.calls.push({ method: "execute", text, values });
    return { rowCount: 1, rows: [] };
  }

  async transaction(callback) {
    return callback(this);
  }
}

class FailingJobs {
  async enqueueAgentGroundedAnswerRequestedJob() {
    throw new Error("SQS unavailable");
  }
}

{
  const database = new FakeDatabase({
    claim: {
      id: OUTBOX_ID,
      run_id: RUN_ID,
      workspace_id: WORKSPACE_ID,
      attempt_count: 5,
      claim_token: CLAIM_TOKEN
    },
    terminalRun: { id: RUN_ID }
  });
  const publisher = new AgentGroundedAnswerOutboxPublisherService(
    database,
    new FailingJobs()
  );

  await publisher.publish(RUN_ID);

  const runFailure = database.calls.find(
    (call) => call.method === "queryOne" && call.text.includes("UPDATE agent_runs")
  );
  assert.match(runFailure.text, /status = 'failed'/);
  assert.match(runFailure.text, /execution_lease_token = NULL/);
  assert.ok(
    database.calls.some(
      (call) =>
        call.method === "execute" &&
        call.text.includes("grounded_answer_outbox_publish_exhausted")
    )
  );
}

{
  const database = new FakeDatabase({ staleRows: [{ id: RUN_ID }] });
  const publisher = new AgentGroundedAnswerOutboxPublisherService(
    database,
    new FailingJobs()
  );

  const recovered = await publisher.recoverStaleRuns();

  assert.equal(recovered, 1);
  const recovery = database.calls.find((call) => call.method === "query");
  assert.deepEqual(recovery.values.slice(0, 2), [300, 20]);
  assert.match(recovery.text, /outbox\.status IN \('pending', 'publishing', 'delivered'\)/);
  assert.match(recovery.text, /grounded_answer_timeout/);
  assert.match(recovery.text, /execution_lease_token = NULL/);
}
