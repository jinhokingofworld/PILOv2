import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AGENT_TOOL_SCHEMA_VERSION, AgentJobService } = require(
  "../../dist/modules/agent/agent-job.service.js"
);
const { AgentOutboxPublisherService } = require(
  "../../dist/modules/agent/agent-outbox-publisher.service.js"
);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const { CalendarAgentToolsService } = require(
  "../../dist/modules/agent/tools/calendar-agent-tools.service.js"
);
const { MeetingAgentToolsService } = require(
  "../../dist/modules/agent/tools/meeting-agent-tools.service.js"
);
const { BoardAgentToolsService } = require(
  "../../dist/modules/agent/tools/board-agent-tools.service.js"
);
const { SqlErdAgentToolsService } = require(
  "../../dist/modules/agent/tools/sql-erd-agent-tools.service.js"
);

const originalEnv = {
  AWS_REGION: process.env.AWS_REGION,
  SQS_AGENT_JOBS_QUEUE_URL: process.env.SQS_AGENT_JOBS_QUEUE_URL,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT
};

const payload = {
  jobType: "agent_run_requested",
  runId: "33333333-3333-3333-3333-333333333333",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  requestedByUserId: "11111111-1111-1111-1111-111111111111",
  requestContext: null,
  turnSequence: 1,
  toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION,
  tools: [
    {
      name: "list_calendar_events",
      description: "Calendar 일정 목록을 날짜 범위 기준으로 조회합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: {
            type: "string",
            format: "date"
          },
          end: {
            type: "string",
            format: "date"
          }
        }
      }
    }
  ]
};

{
  const suite = JSON.parse(
    readFileSync(
      new URL("../../../ai-worker/evals/agent_planner_korean_v1.json", import.meta.url),
      "utf8"
    )
  );
  const sqlErdFocusEvaluation = suite.cases.find(
    (candidate) => candidate.id === "sql_erd_focus_payment_tables"
  );
  assert.equal(
    sqlErdFocusEvaluation?.expected?.requiresConfirmation,
    null,
    "contextual SQLtoERD inspection must not require confirmation"
  );
  const registry = new AgentToolRegistryService(
    new CalendarAgentToolsService({}),
    new MeetingAgentToolsService({}),
    new BoardAgentToolsService({}),
    new SqlErdAgentToolsService({})
  );
  const actualSnapshot = registry.listDefinitions().map((definition) => ({
    name: definition.name,
    description: definition.description,
    riskLevel: definition.riskLevel,
    executionMode: definition.executionMode,
    inputSchema: definition.inputSchema
  }));

  assert.deepEqual(suite.tools, actualSnapshot);
}

class FakeSqsClient {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.commands = [];
    this.destroyCalls = 0;
  }

  async send(command) {
    this.commands.push(command);

    if (this.shouldFail) {
      throw new Error("raw AWS queue failure with queue url");
    }

    return {
      MessageId: "message-1"
    };
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class TestAgentJobService extends AgentJobService {
  constructor(client) {
    super();
    this.client = client;
    this.configs = [];
  }

  createSqsClient(config) {
    this.configs.push(config);
    return this.client;
  }
}

class FakeOutboxDatabaseService {
  constructor({ claim, dueRows = [], terminalRun = null } = {}) {
    this.claim = claim ?? null;
    this.dueRows = dueRows;
    this.terminalRun = terminalRun;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });
    return this.dueRows;
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    return callback({
      queryOne: async (text, values = []) => {
        this.calls.push({ method: "queryOne", text, values });

        if (text.includes("WITH candidate")) {
          return this.claim;
        }

        if (text.includes("RETURNING run_id, workspace_id")) {
          return this.claim
            ? {
                run_id: this.claim.run_id,
                workspace_id: this.claim.workspace_id
              }
            : null;
        }

        if (text.includes("UPDATE agent_runs")) {
          return this.terminalRun;
        }

        throw new Error(`Unhandled outbox queryOne: ${text}`);
      },
      execute: async (text, values = []) => {
        this.calls.push({ method: "transaction.execute", text, values });
        return { rows: [] };
      }
    });
  }
}

class FakeOutboxJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async enqueueAgentRunRequestedJob(job) {
    this.calls.push(job);

    if (this.shouldFail) {
      throw new Error("SQS unavailable");
    }
  }
}

class FakeOutboxToolRegistryService {
  constructor() {
    this.calls = [];
  }

  listDefinitions() {
    return this.definitions();
  }

  listDefinitionsForContext(requestContext) {
    this.calls.push({ method: "listDefinitionsForContext", requestContext });
    return this.definitions().filter(
      (definition) =>
        !definition.contextRequirement ||
        definition.contextRequirement.surface === requestContext?.surface
    );
  }

  definitions() {
    return [
      {
        name: "list_calendar_events",
        description: "Calendar 일정 목록을 조회합니다.",
        riskLevel: "low",
        executionMode: "auto",
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      },
      {
        name: "pr_review_fixture",
        description: "PR Review fixture",
        riskLevel: "low",
        executionMode: "contextual",
        contextRequirement: {
          surface: "pr_review"
        },
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      }
    ];
  }
}

function createOutboxClaim(overrides = {}) {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    run_id: payload.runId,
    workspace_id: payload.workspaceId,
    requested_by_user_id: payload.requestedByUserId,
    request_context_json: payload.requestContext,
    attempt_count: 1,
    claim_token: "55555555-5555-5555-5555-555555555555",
    turn_sequence: 1,
    ...overrides
  };
}

try {
  process.env.AWS_REGION = "ap-northeast-2";
  process.env.SQS_AGENT_JOBS_QUEUE_URL =
    "http://localhost:4566/000000000000/pilo-dev-agent-jobs";
  process.env.SQS_ENDPOINT = "http://localhost:4566";

  {
    const client = new FakeSqsClient();
    const service = new TestAgentJobService(client);

    await service.enqueueAgentRunRequestedJob(payload);
    await service.enqueueAgentRunRequestedJob({
      ...payload,
      runId: "44444444-4444-4444-4444-444444444444"
    });

    assert.deepEqual(service.configs, [
      {
        awsRegion: "ap-northeast-2",
        queueUrl: "http://localhost:4566/000000000000/pilo-dev-agent-jobs",
        endpoint: "http://localhost:4566"
      }
    ]);
    assert.equal(client.commands.length, 2);
    assert.equal(client.commands[0].constructor.name, "SendMessageCommand");
    assert.equal(
      client.commands[0].input.QueueUrl,
      "http://localhost:4566/000000000000/pilo-dev-agent-jobs"
    );
    assert.deepEqual(JSON.parse(client.commands[0].input.MessageBody), payload);
    assert.deepEqual(JSON.parse(client.commands[1].input.MessageBody), {
      ...payload,
      runId: "44444444-4444-4444-4444-444444444444"
    });
    assert.equal(client.commands[0].input.MessageGroupId, undefined);
    assert.equal(client.commands[0].input.MessageDeduplicationId, undefined);

    service.onModuleDestroy();
    assert.equal(client.destroyCalls, 1);
  }

  {
    delete process.env.SQS_AGENT_JOBS_QUEUE_URL;
    const client = new FakeSqsClient();
    const service = new TestAgentJobService(client);

    try {
      await service.enqueueAgentRunRequestedJob(payload);
      assert.fail("Expected missing SQS queue config failure");
    } catch (error) {
      assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Agent job queue is not configured"
        }
      });
    }
    assert.equal(client.commands.length, 0);
    assert.equal(service.configs.length, 0);
  }

  {
    process.env.SQS_AGENT_JOBS_QUEUE_URL =
      "http://localhost:4566/000000000000/pilo-dev-agent-jobs";
    const client = new FakeSqsClient({ shouldFail: true });
    const service = new TestAgentJobService(client);

    try {
      await service.enqueueAgentRunRequestedJob(payload);
      assert.fail("Expected SQS publish failure");
    } catch (error) {
      assert.equal(error.getStatus(), 503);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Agent job could not be enqueued"
        }
      });
      assert.doesNotMatch(
        JSON.stringify(error.getResponse()),
        /raw AWS queue failure|pilo-dev-agent-jobs/
      );
    }
  }

  {
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim(),
      dueRows: [{ run_id: payload.runId }]
    });
    const jobService = new FakeOutboxJobService();
    const registry = new FakeOutboxToolRegistryService();
    const publisher = new AgentOutboxPublisherService(
      database,
      jobService,
      registry
    );

    await publisher.publishDueEvents();

    assert.equal(jobService.calls.length, 1);
    assert.equal(jobService.calls[0].runId, payload.runId);
    assert.equal(jobService.calls[0].turnSequence, 1);
    assert.equal(jobService.calls[0].toolSchemaVersion, AGENT_TOOL_SCHEMA_VERSION);
    assert.equal(jobService.calls[0].requestContext, null);
    assert.deepEqual(jobService.calls[0].tools, [
      {
        name: "list_calendar_events",
        description: "Calendar 일정 목록을 조회합니다.",
        riskLevel: "low",
        executionMode: "auto",
        inputSchema: {
          type: "object",
          additionalProperties: false
        }
      }
    ]);
    assert.deepEqual(registry.calls, [
      { method: "listDefinitionsForContext", requestContext: null }
    ]);
    assert.match(
      database.calls.find((call) => call.method === "queryOne").text,
      /FOR UPDATE OF outbox SKIP LOCKED/
    );
    assert.match(
      database.calls.find((call) => call.method === "queryOne").text,
      /outbox\.turn_sequence/
    );
    assert.match(
      database.calls.find((call) => call.method === "query").text,
      /outbox.status = 'publishing'/
    );
    const delivered = database.calls.find(
      (call) => call.method === "execute" && call.text.includes("delivered_at")
    );
    assert.match(
      delivered.text,
      /SET status = 'delivered'/
    );
    assert.deepEqual(delivered.values, [
      "44444444-4444-4444-4444-444444444444",
      "55555555-5555-5555-5555-555555555555"
    ]);
  }

  {
    const requestContext = {
      surface: "pr_review",
      sessionId: "77777777-7777-4777-8777-777777777777"
    };
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim({ request_context_json: requestContext }),
      dueRows: [{ run_id: payload.runId }]
    });
    const jobService = new FakeOutboxJobService();
    const registry = new FakeOutboxToolRegistryService();
    const publisher = new AgentOutboxPublisherService(
      database,
      jobService,
      registry
    );

    await publisher.publishDueEvents();

    assert.deepEqual(
      jobService.calls[0].tools.map((tool) => tool.name),
      ["list_calendar_events", "pr_review_fixture"]
    );
    assert.deepEqual(registry.calls, [
      { method: "listDefinitionsForContext", requestContext }
    ]);
  }

  {
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim({ attempt_count: 1 })
    });
    const publisher = new AgentOutboxPublisherService(
      database,
      new FakeOutboxJobService({ shouldFail: true }),
      new FakeOutboxToolRegistryService()
    );

    await publisher.publishCreatedRun(payload.runId);

    const retry = database.calls.find(
      (call) =>
        call.method === "execute" && call.text.includes("next_attempt_at = $2")
    );
    assert.equal(retry.values[2], "AGENT_OUTBOX_PUBLISH_FAILED");
    assert.equal(retry.values[3], "Agent planning job could not be published");
    assert.equal(retry.values[4], "55555555-5555-5555-5555-555555555555");
    assert.ok(retry.values[1] instanceof Date);
    assert.ok(retry.values[1].getTime() > Date.now());
  }

  {
    const database = new FakeOutboxDatabaseService({
      claim: createOutboxClaim({ attempt_count: 6 }),
      terminalRun: { id: payload.runId }
    });
    const publisher = new AgentOutboxPublisherService(
      database,
      new FakeOutboxJobService({ shouldFail: true }),
      new FakeOutboxToolRegistryService()
    );

    await publisher.publishCreatedRun(payload.runId);

    assert.match(
      database.calls.find(
        (call) =>
          call.method === "queryOne" &&
          call.text.includes("RETURNING run_id, workspace_id")
      ).text,
      /SET status = 'failed'/
    );
    assert.match(
      database.calls.find(
        (call) => call.method === "queryOne" && call.text.includes("UPDATE agent_runs")
      ).text,
      /AND status = 'planning'/
    );
    assert.match(
      database.calls.find(
        (call) => call.method === "transaction.execute"
      ).text,
      /outbox_publish_exhausted/
    );
  }
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
