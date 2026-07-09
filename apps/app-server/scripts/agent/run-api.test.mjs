import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentController } = require(
  "../../dist/modules/agent/agent.controller.js"
);
const { AGENT_TOOL_SCHEMA_VERSION } = require(
  "../../dist/modules/agent/agent-job.service.js"
);
const { AgentService } = require("../../dist/modules/agent/agent.service.js");

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "99999999-9999-9999-9999-999999999999";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const STEP_ID = "44444444-4444-4444-4444-444444444444";
const CONFIRMATION_ID = "55555555-5555-5555-5555-555555555555";
const CREATED_AT = new Date("2026-07-08T00:00:00.000Z");
const UPDATED_AT = new Date("2026-07-08T00:01:00.000Z");
const EXPIRES_AT = new Date("2026-08-07T00:00:00.000Z");
const CONFIRMATION_EXPIRES_AT = new Date("2026-07-08T00:15:00.000Z");
const TOOL_SCHEMA_SNAPSHOT = [
  {
    name: "list_calendar_events",
    description: "Calendar 일정 목록을 날짜 범위 기준으로 조회합니다.",
    riskLevel: "low",
    executionMode: "auto",
    inputSchema: {
      type: "object",
      required: ["start", "end"],
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
  },
  {
    name: "create_calendar_event",
    description: "Calendar 일정을 생성합니다. 실행 전 confirmation이 필요합니다.",
    riskLevel: "medium",
    executionMode: "confirmation_required",
    inputSchema: {
      type: "object",
      required: ["title", "startDate", "endDate"],
      additionalProperties: false,
      properties: {
        title: {
          type: "string"
        },
        startDate: {
          type: "string",
          format: "date"
        },
        endDate: {
          type: "string",
          format: "date"
        }
      }
    }
  }
];

function createStoredRun(overrides = {}) {
  return {
    id: RUN_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    clientRequestId: "request-1",
    status: "planning",
    riskLevel: null,
    prompt: "내일 회의 일정 만들어줘",
    timezone: "Asia/Seoul",
    message: "요청을 분석하고 있습니다.",
    finalAnswer: null,
    errorCode: null,
    errorMessage: null,
    expiresAt: EXPIRES_AT.toISOString(),
    completedAt: null,
    createdAt: CREATED_AT.toISOString(),
    updatedAt: UPDATED_AT.toISOString(),
    ...overrides
  };
}

function createRunRow(overrides = {}) {
  return {
    id: RUN_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    client_request_id: "request-1",
    status: "planning",
    risk_level: null,
    prompt: "내일 회의 일정 만들어줘",
    timezone: "Asia/Seoul",
    message: "요청을 분석하고 있습니다.",
    final_answer: null,
    error_message: null,
    expires_at: EXPIRES_AT,
    completed_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function createRunListRow(overrides = {}) {
  return {
    ...createRunRow({
      status: "waiting_confirmation",
      risk_level: "medium",
      message: "일정 생성 전 확인이 필요합니다."
    }),
    confirmation_id: CONFIRMATION_ID,
    confirmation_status: "pending",
    confirmation_risk_level: "medium",
    confirmation_expires_at: CONFIRMATION_EXPIRES_AT,
    ...overrides
  };
}

function createStepRow(overrides = {}) {
  return {
    id: STEP_ID,
    run_id: RUN_ID,
    step_order: 1,
    step_type: "planner",
    status: "completed",
    tool_name: null,
    risk_level: "low",
    input_json: {
      promptLength: 12,
      authorizationToken: "must-not-leak"
    },
    output_json: {
      intent: "calendar.list",
      transcriptText: "must-not-leak"
    },
    resource_refs: [
      {
        domain: "calendar",
        resourceType: "event",
        resourceId: "event-1",
        label: "주간 회의",
        metadata: {
          token: "must-not-leak",
          visible: "ok"
        }
      }
    ],
    error_message: null,
    started_at: new Date("2026-07-08T00:00:10.000Z"),
    completed_at: new Date("2026-07-08T00:00:20.000Z"),
    ...overrides
  };
}

function createConfirmationRow(overrides = {}) {
  return {
    id: CONFIRMATION_ID,
    run_id: RUN_ID,
    status: "pending",
    risk_level: "medium",
    plan_json: {
      toolName: "create_calendar_event",
      summary: "주간 회의 일정을 생성합니다.",
      target: {
        domain: "calendar",
        resourceType: "event"
      },
      before: null,
      after: {
        title: "주간 회의",
        providerRawResponse: "must-not-leak"
      },
      call: {
        method: "POST",
        path: "/api/v1/workspaces/{workspaceId}/calendar/events"
      }
    },
    expires_at: CONFIRMATION_EXPIRES_AT,
    approved_at: null,
    rejected_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(currentUserId, workspaceId) {
    this.calls.push({ currentUserId, workspaceId });
  }
}

class FakeAgentLoggingService {
  constructor(result) {
    this.result = result;
    this.calls = [];
    this.failCalls = [];
  }

  async createRun(currentUserId, workspaceId, input) {
    this.calls.push({ currentUserId, workspaceId, input });
    return this.result;
  }

  async failRun(currentUserId, workspaceId, input) {
    this.failCalls.push({ currentUserId, workspaceId, input });
    return createStoredRun({
      status: "failed",
      message: input.message,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage
    });
  }
}

class FakeAgentJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async enqueueAgentRunRequestedJob(payload) {
    this.calls.push(payload);

    if (this.shouldFail) {
      throw new Error("raw SQS failure with pilo-dev-ai-jobs queue url");
    }
  }
}

class FakeAgentToolRegistryService {
  listDefinitions() {
    return TOOL_SCHEMA_SNAPSHOT.map((tool) => ({
      ...tool,
      validateInput: () => ({}),
      execute: async () => ({
        outputSummary: {},
        resourceRefs: []
      })
    }));
  }
}

class FakeAgentExecutionService {
  constructor() {
    this.calls = [];
  }

  async executeLatestPlannedTool(currentUserId, workspaceId, runId) {
    this.calls.push({ currentUserId, workspaceId, runId });
    return {
      status: "skipped",
      reason: "not_ready"
    };
  }
}

class FakeAgentRunService {
  constructor(results) {
    this.results = [...results];
    this.calls = [];
  }

  async createRun(currentUserId, workspaceId, body) {
    this.calls.push({ currentUserId, workspaceId, body });
    return this.results.shift();
  }
}

class FakeDatabaseService {
  constructor(state) {
    this.state = state;
    this.calls = [];
  }

  async queryOne(text, values = []) {
    this.calls.push({ method: "queryOne", text, values });

    if (text.includes("COUNT(*)")) {
      return { total: this.state.total ?? this.state.listRows.length };
    }

    if (text.includes("FROM agent_runs") && text.includes("WHERE id = $1")) {
      const [runId, workspaceId, currentUserId] = values;
      return (
        this.state.runRows.find(
          (run) =>
            run.id === runId &&
            run.workspace_id === workspaceId &&
            run.requested_by_user_id === currentUserId
        ) ?? null
      );
    }

    if (text.includes("FROM agent_confirmations")) {
      const [runId] = values;
      return (
        this.state.confirmationRows.find(
          (confirmation) => confirmation.run_id === runId
        ) ?? null
      );
    }

    throw new Error(`Unhandled queryOne: ${text}`);
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });

    if (text.includes("FROM agent_runs r")) {
      return this.state.listRows;
    }

    if (text.includes("FROM agent_steps")) {
      const [runId] = values;
      return this.state.stepRows.filter((step) => step.run_id === runId);
    }

    throw new Error(`Unhandled query: ${text}`);
  }
}

function createService({
  loggingResult = {
    run: createStoredRun(),
    created: true
  },
  state = {
    listRows: [],
    runRows: [],
    stepRows: [],
    confirmationRows: []
  },
  agentJobService = new FakeAgentJobService(),
  agentExecutionService = new FakeAgentExecutionService()
} = {}) {
  const workspaceService = new FakeWorkspaceService();
  const database = new FakeDatabaseService(state);
  const agentLoggingService = new FakeAgentLoggingService(loggingResult);
  const agentToolRegistryService = new FakeAgentToolRegistryService();

  return {
    service: new AgentService(
      database,
      workspaceService,
      agentLoggingService,
      agentJobService,
      agentToolRegistryService,
      agentExecutionService
    ),
    workspaceService,
    database,
    agentLoggingService,
    agentJobService,
    agentToolRegistryService,
    agentExecutionService
  };
}

function errorCode(error) {
  return error.getResponse().error.code;
}

function errorMessage(error) {
  return error.getResponse().error.message;
}

{
  const runService = new FakeAgentRunService([
    {
      run: {
        ...createStoredRun(),
        steps: [],
        confirmation: null
      },
      created: true
    },
    {
      run: {
        ...createStoredRun(),
        steps: [],
        confirmation: null
      },
      created: false
    }
  ]);
  const controller = new AgentController(runService, {});
  const createdReply = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
  const reusedReply = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    }
  };

  const created = await controller.createRun(
    USER_ID,
    WORKSPACE_ID,
    { prompt: "내일 회의 일정 만들어줘" },
    createdReply
  );
  const reused = await controller.createRun(
    USER_ID,
    WORKSPACE_ID,
    { prompt: "내일 회의 일정 만들어줘" },
    reusedReply
  );

  assert.equal(createdReply.statusCode, 202);
  assert.equal(reusedReply.statusCode, 200);
  assert.equal(created.success, true);
  assert.equal(reused.success, true);
}

{
  const { service, agentLoggingService, agentJobService } = createService();
  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "  내일 회의 일정 만들어줘  ",
    timezone: "Asia/Seoul",
    clientRequestId: " request-1 "
  });

  assert.equal(result.created, true);
  assert.equal(result.run.id, RUN_ID);
  assert.deepEqual(result.run.steps, []);
  assert.equal(result.run.confirmation, null);
  assert.deepEqual(agentLoggingService.calls, [
    {
      currentUserId: USER_ID,
      workspaceId: WORKSPACE_ID,
      input: {
        prompt: "내일 회의 일정 만들어줘",
        timezone: "Asia/Seoul",
        clientRequestId: "request-1"
      }
    }
  ]);
  assert.deepEqual(agentJobService.calls, [
    {
      jobType: "agent_run_requested",
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION,
      tools: TOOL_SCHEMA_SNAPSHOT
    }
  ]);
  assert.equal("validateInput" in agentJobService.calls[0].tools[0], false);
  assert.equal("execute" in agentJobService.calls[0].tools[0], false);
}

{
  const { service, agentJobService } = createService({
    loggingResult: {
      run: createStoredRun(),
      created: false
    }
  });
  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "내일 회의 일정 만들어줘",
    clientRequestId: "request-1"
  });

  assert.equal(result.created, false);
  assert.equal(result.run.status, "planning");
  assert.deepEqual(agentJobService.calls, []);
}

{
  const agentJobService = new FakeAgentJobService({ shouldFail: true });
  const { service, agentLoggingService } = createService({ agentJobService });

  await assert.rejects(
    () =>
      service.createRun(USER_ID, WORKSPACE_ID, {
        prompt: "내일 회의 일정 만들어줘"
      }),
    (error) => {
      assert.equal(error.getStatus(), 503);
      assert.equal(errorCode(error), "SERVICE_UNAVAILABLE");
      assert.equal(errorMessage(error), "Agent job could not be enqueued");
      assert.doesNotMatch(
        JSON.stringify(error.getResponse()),
        /raw SQS failure|pilo-dev-ai-jobs/
      );
      return true;
    }
  );
  assert.deepEqual(agentJobService.calls, [
    {
      jobType: "agent_run_requested",
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION,
      tools: TOOL_SCHEMA_SNAPSHOT
    }
  ]);
  assert.deepEqual(agentLoggingService.failCalls, [
    {
      currentUserId: USER_ID,
      workspaceId: WORKSPACE_ID,
      input: {
        runId: RUN_ID,
        errorCode: "AGENT_JOB_ENQUEUE_FAILED",
        errorMessage: "Agent job could not be enqueued",
        message: "요청을 시작하지 못했습니다. 잠시 후 다시 시도해주세요."
      }
    }
  ]);
}

{
  const { service } = createService();

  await assert.rejects(
    () =>
      service.createRun(USER_ID, WORKSPACE_ID, {
        prompt: "내일 회의 일정 만들어줘",
        timezone: "Mars/Olympus_Mons"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.equal(errorMessage(error), "timezone must be a valid IANA timezone");
      return true;
    }
  );
}

{
  const { service } = createService();

  await assert.rejects(
    () =>
      service.createRun(USER_ID, WORKSPACE_ID, {
        prompt: "내일 회의 일정 만들어줘",
        workspaceId: WORKSPACE_ID
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorMessage(error), "workspaceId must not be provided");
      return true;
    }
  );
}

{
  const state = {
    listRows: [createRunListRow()],
    runRows: [],
    stepRows: [],
    confirmationRows: []
  };
  const { service, workspaceService, database } = createService({ state });
  const result = await service.listRuns(USER_ID, WORKSPACE_ID, {
    status: "waiting_confirmation",
    page: "2",
    limit: "10"
  });

  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].confirmation.id, CONFIRMATION_ID);
  assert.equal(result.runs[0].confirmation.riskLevel, "medium");
  assert.deepEqual(result.meta, {
    page: 2,
    limit: 10,
    total: 1
  });
  assert.deepEqual(workspaceService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID }
  ]);
  assert.deepEqual(database.calls[0].values, [
    WORKSPACE_ID,
    USER_ID,
    "waiting_confirmation"
  ]);
  assert.deepEqual(database.calls[1].values, [
    WORKSPACE_ID,
    USER_ID,
    "waiting_confirmation",
    10,
    10
  ]);
}

{
  const { service } = createService();

  await assert.rejects(
    () => service.listRuns(USER_ID, WORKSPACE_ID, { status: "queued" }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorMessage(error), "status must be a valid Agent run status");
      return true;
    }
  );
}

{
  const { service } = createService();

  await assert.rejects(
    () => service.listRuns(USER_ID, WORKSPACE_ID, { limit: "101" }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorMessage(error), "limit must be 100 or less");
      return true;
    }
  );
}

{
  const state = {
    listRows: [],
    runRows: [createRunRow()],
    stepRows: [createStepRow()],
    confirmationRows: [createConfirmationRow()]
  };
  const { service, agentExecutionService } = createService({ state });
  const result = await service.getRun(USER_ID, WORKSPACE_ID, RUN_ID);

  assert.deepEqual(agentExecutionService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID, runId: RUN_ID }
  ]);
  assert.equal(result.run.id, RUN_ID);
  assert.equal(result.run.steps[0].inputSummary.promptLength, 12);
  assert.equal("authorizationToken" in result.run.steps[0].inputSummary, false);
  assert.equal("transcriptText" in result.run.steps[0].outputSummary, false);
  assert.equal(result.run.steps[0].resourceRefs[0].metadata.visible, "ok");
  assert.equal("token" in result.run.steps[0].resourceRefs[0].metadata, false);
  assert.equal(result.run.confirmation.id, CONFIRMATION_ID);
  assert.equal(result.run.confirmation.plan.after.title, "주간 회의");
  assert.equal(
    "providerRawResponse" in result.run.confirmation.plan.after,
    false
  );
}

{
  const state = {
    listRows: [],
    runRows: [
      createRunRow({
        requested_by_user_id: OTHER_USER_ID
      })
    ],
    stepRows: [],
    confirmationRows: []
  };
  const { service } = createService({ state });

  await assert.rejects(
    () => service.getRun(USER_ID, WORKSPACE_ID, RUN_ID),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(errorMessage(error), "Agent run not found");
      return true;
    }
  );
}
