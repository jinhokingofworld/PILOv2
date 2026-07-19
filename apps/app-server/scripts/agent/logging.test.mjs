import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentLoggingService } = require(
  "../../dist/modules/agent/agent-logging.service.js"
);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const SQL_ERD_SESSION_ID = "77777777-7777-4777-8777-777777777777";
const PR_REVIEW_SESSION_ID = "88888888-8888-4888-8888-888888888888";
const STEP_ID = "44444444-4444-4444-4444-444444444444";
const THREAD_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = new Date("2026-07-08T00:00:00.000Z");
const UPDATED_AT = new Date("2026-07-08T00:00:01.000Z");
const EXPIRES_AT = new Date("2026-08-07T00:00:00.000Z");

function createRun(overrides = {}) {
  return {
    id: RUN_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    client_request_id: null,
    request_context_json: null,
    status: "planning",
    risk_level: null,
    prompt: "내일 회의 일정 만들어줘",
    timezone: "Asia/Seoul",
    message: "요청을 분석하고 있습니다.",
    final_answer: null,
    error_code: null,
    error_message: null,
    expires_at: EXPIRES_AT,
    completed_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function createStep(overrides = {}) {
  return {
    id: STEP_ID,
    run_id: RUN_ID,
    step_order: 1,
    step_type: "tool",
    status: "running",
    tool_name: "list_calendar_events",
    risk_level: "low",
    input_json: {},
    output_json: {},
    resource_refs: [],
    error_code: null,
    error_message: null,
    started_at: new Date("2026-07-08T00:01:00.000Z"),
    completed_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides
  };
}

function parseJsonParameter(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(currentUserId, workspaceId) {
    this.calls.push({ currentUserId, workspaceId });
  }
}

class FakeDatabaseService {
  constructor(state) {
    this.state = state;
    this.transactionCount = 0;
  }

  async transaction(callback) {
    this.transactionCount += 1;
    const snapshot = structuredClone(this.state);
    try {
      return await callback(new FakeTransaction(this.state));
    } catch (error) {
      for (const key of Object.keys(this.state)) {
        delete this.state[key];
      }
      Object.assign(this.state, snapshot);
      throw error;
    }
  }
}

class FakeTransaction {
  constructor(state) {
    this.state = state;
  }

  async queryOne(text, values = []) {
    if (text.includes("FROM agent_threads AS thread")) {
      this.state.threadLookupQuery = text;
      return this.findActiveThread(values);
    }

    if (text.includes("INSERT INTO agent_threads")) {
      return this.insertThread(values);
    }

    if (text.includes("UPDATE agent_run_outbox")) {
      const outbox = this.state.outbox?.find((row) => row.run_id === values[0]);
      if (!outbox) return null;
      outbox.status = "pending";
      outbox.turn_sequence = (outbox.turn_sequence ?? 1) + 1;
      outbox.reason = "tool_result";
      return { id: outbox.id ?? "outbox-1" };
    }

    if (text.includes("COALESCE(MAX(sequence)")) {
      return { sequence: (this.state.messages?.length ?? 0) + 1 };
    }

    if (text.includes("INSERT INTO agent_runs")) {
      return this.insertRun(values);
    }

    if (text.includes("INSERT INTO agent_steps")) {
      return this.insertStep(values);
    }

    if (text.includes("UPDATE agent_steps")) {
      return this.updateStep(text, values);
    }

    if (text.includes("UPDATE agent_runs")) {
      return this.updateRun(text, values);
    }

    if (text.includes("client_request_id = $3")) {
      return this.findRunByClientRequest(values);
    }

    if (text.includes("FROM agent_steps") && text.includes("step_type = 'tool'")) {
      return this.findExistingToolStep(values);
    }

    if (text.includes("SELECT * FROM agent_steps")) {
      return this.findStep(values);
    }

    if (text.includes("COALESCE(MAX(step_order)")) {
      return this.nextStepOrder(values);
    }

    if (text.includes("FROM agent_runs")) {
      return this.findOwnedRun(values);
    }

    throw new Error(`Unhandled queryOne: ${text}`);
  }

  async execute(text, values = []) {
    if (text.includes("pg_advisory_xact_lock")) {
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("UPDATE agent_threads SET last_activity_at")) {
      const thread = this.state.threads?.find((candidate) => candidate.id === values[0]);
      if (thread) thread.last_activity_at = new Date();
      return { rowCount: thread ? 1 : 0, rows: [] };
    }

    if (text.includes("INSERT INTO agent_run_messages")) {
      this.state.messages ??= [];
      this.state.messages.push({
        run_id: values[0],
        sequence: values[1],
        role: "assistant",
        content: values[2]
      });
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("INSERT INTO agent_logs")) {
      this.insertLog(values);
      return {
        rowCount: 1,
        rows: []
      };
    }

    if (text.includes("INSERT INTO agent_run_outbox")) {
      const [runId, workspaceId] = values;
      this.state.outbox ??= [];
      this.state.outbox.push({
        run_id: runId,
        workspace_id: workspaceId,
        status: "pending"
      });
      return {
        rowCount: 1,
        rows: []
      };
    }

    throw new Error(`Unhandled execute: ${text}`);
  }

  findRunByClientRequest([workspaceId, currentUserId, clientRequestId]) {
    if (this.state.clientRequestMissesRemaining > 0) {
      this.state.clientRequestMissesRemaining -= 1;
      return null;
    }

    const run = this.state.runs.find(
      (candidate) =>
        candidate.workspace_id === workspaceId &&
        candidate.requested_by_user_id === currentUserId &&
        candidate.client_request_id === clientRequestId
    );

    return run ? { ...run } : null;
  }

  findOwnedRun([runId, workspaceId, currentUserId]) {
    const run = this.state.runs.find(
      (candidate) =>
        candidate.id === runId &&
        candidate.workspace_id === workspaceId &&
        candidate.requested_by_user_id === currentUserId
    );

    return run ? { ...run } : null;
  }

  findExistingToolStep([runId]) {
    const step = this.state.steps.find(
      (candidate) => candidate.run_id === runId && candidate.step_type === "tool"
    );

    return step ? { id: step.id } : null;
  }

  findStep([stepId, runId]) {
    const step = this.state.steps.find(
      (candidate) => candidate.id === stepId && candidate.run_id === runId
    );
    return step ? { ...step } : null;
  }

  nextStepOrder([runId]) {
    const maxOrder = this.state.steps
      .filter((candidate) => candidate.run_id === runId)
      .reduce((max, candidate) => Math.max(max, candidate.step_order), 0);

    return { next_order: maxOrder + 1 };
  }

  findActiveThread([workspaceId, currentUserId]) {
    if (this.state.activeThread === false) return null;
    const thread = (this.state.threads ?? []).find(
      (candidate) =>
        candidate.workspace_id === workspaceId &&
        candidate.requested_by_user_id === currentUserId
    );
    return thread ? { id: thread.id } : null;
  }

  insertThread([workspaceId, currentUserId]) {
    this.state.threads ??= [];
    const thread = {
      id: this.state.threads.length === 0 ? THREAD_ID : "new-thread-id",
      workspace_id: workspaceId,
      requested_by_user_id: currentUserId,
      last_activity_at: new Date()
    };
    this.state.threads.push(thread);
    return { id: thread.id };
  }

  insertRun([
    workspaceId,
    currentUserId,
    threadId,
    clientRequestId,
    requestContext,
    prompt,
    timezone,
    message
  ]) {
    if (this.state.insertRunConflict) {
      return null;
    }

    const run = createRun({
      workspace_id: workspaceId,
      requested_by_user_id: currentUserId,
      thread_id: threadId,
      client_request_id: clientRequestId,
      request_context_json: requestContext,
      prompt,
      timezone,
      message
    });

    this.state.runs.push(run);
    return { ...run };
  }

  insertStep([
    runId,
    order,
    type,
    toolName,
    riskLevel,
    inputSummary
  ]) {
    const step = createStep({
      run_id: runId,
      step_order: order,
      step_type: type,
      tool_name: toolName,
      risk_level: riskLevel,
      input_json: inputSummary
    });

    this.state.steps.push(step);
    return { ...step };
  }

  updateStep(text, values) {
    const [stepId, runId] = values;
    const step = this.state.steps.find(
      (candidate) => candidate.id === stepId && candidate.run_id === runId
    );

    if (!step) {
      return null;
    }

    if (text.includes("AND status = 'running'") && step.status !== "running") {
      return null;
    }

    if (text.includes("status = 'completed'")) {
      const [, , outputSummary, resourceRefs] = values;
      this.state.lastStepResourceRefsParameter = resourceRefs;
      step.status = "completed";
      step.output_json = outputSummary;
      step.resource_refs = parseJsonParameter(resourceRefs);
      step.error_code = null;
      step.error_message = null;
      step.completed_at = new Date("2026-07-08T00:02:00.000Z");
    } else if (text.includes("status = 'failed'")) {
      const [, , errorCode, errorMessage] = values;
      step.status = "failed";
      step.error_code = errorCode;
      step.error_message = errorMessage;
      step.completed_at = new Date("2026-07-08T00:03:00.000Z");
    }

    return { ...step };
  }

  updateRun(text, values) {
    const [runId, workspaceId] = values;
    const usesWorkspaceId = text.includes("workspace_id = $2");
    const run = this.state.runs.find(
      (candidate) =>
        candidate.id === runId &&
        (!usesWorkspaceId || candidate.workspace_id === workspaceId)
    );

    if (!run) {
      return null;
    }


    if (
      text.includes("tool_call_count < 4") &&
      (run.tool_call_count ?? 0) >= 4
    ) {
      return null;
    }

    if (text.includes("status = 'completed'")) {
      const [, , riskLevel, message, finalAnswer] = values;
      run.status = "completed";
      run.risk_level = riskLevel ?? run.risk_level;
      run.message = message;
      run.final_answer = finalAnswer;
      run.error_code = null;
      run.error_message = null;
      run.completed_at = new Date("2026-07-08T00:04:00.000Z");
    } else if (text.includes("status = 'failed'")) {
      const [, , message, errorCode, errorMessage] = values;
      run.status = "failed";
      run.message = message;
      run.error_code = errorCode;
      run.error_message = errorMessage;
      run.completed_at = new Date("2026-07-08T00:05:00.000Z");
    } else if (text.includes("status = 'cancelled'")) {
      const [, , message] = values;
      run.status = "cancelled";
      run.message = message;
      run.completed_at = new Date("2026-07-08T00:06:00.000Z");
    } else if (text.includes("status = 'waiting_user_input'")) {
      run.status = "waiting_user_input";
      run.risk_level = values[1] ?? run.risk_level;
      run.message = values[2];
      run.final_answer = null;
      run.tool_call_count = Math.min(
        (run.tool_call_count ?? 0) + (values[3] === true ? 0 : 1),
        5
      );
    } else if (text.includes("status = 'planning'")) {
      run.status = "planning";
      run.tool_call_count = (run.tool_call_count ?? 0) + 1;
      run.final_answer = null;
    }

    return { ...run };
  }

  insertLog([
    workspaceId,
    runId,
    stepId,
    confirmationId,
    actorType,
    actorUserId,
    level,
    eventType,
    message,
    metadata,
    resourceRefs
  ]) {
    this.state.lastLogResourceRefsParameter = resourceRefs;
    this.state.logs.push({
      workspace_id: workspaceId,
      run_id: runId,
      step_id: stepId,
      confirmation_id: confirmationId,
      actor_type: actorType,
      actor_user_id: actorUserId,
      level,
      event_type: eventType,
      message,
      metadata_json: metadata,
      resource_refs: parseJsonParameter(resourceRefs)
    });
  }
}

{
  const state = {
    runs: [], steps: [], logs: [], activeThread: false,
    threads: [{ id: THREAD_ID, workspace_id: WORKSPACE_ID, requested_by_user_id: USER_ID }]
  };
  const { service } = createService(state);
  await service.createRun(USER_ID, WORKSPACE_ID, { prompt: "한 시간 뒤의 새 요청" });
  assert.equal(state.threads.length, 2);
  assert.equal(state.runs[0].thread_id, "new-thread-id");
  assert.equal(state.threadLookupQuery, undefined);
}

{
  const state = {
    runs: [], steps: [], logs: [], activeThread: true,
    threads: [{ id: THREAD_ID, workspace_id: WORKSPACE_ID, requested_by_user_id: USER_ID }]
  };
  const { service } = createService(state);
  await service.createRun(USER_ID, WORKSPACE_ID, { prompt: "confirmation 대기 중인 요청" });
  assert.equal(state.threads.length, 2);
  assert.equal(state.runs[0].thread_id, "new-thread-id");
  assert.equal(state.threadLookupQuery, undefined);
}

function createService(state) {
  const workspaceService = new FakeWorkspaceService();
  const database = new FakeDatabaseService(state);

  return {
    service: new AgentLoggingService(database, workspaceService),
    workspaceService,
    database
  };
}

function errorCode(error) {
  return error.getResponse().error.code;
}

function errorMessage(error) {
  return error.getResponse().error.message;
}

{
  const state = {
    runs: [],
    steps: [],
    logs: []
  };
  const { service, workspaceService } = createService(state);
  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "  내일 회의 일정 만들어줘  ",
    clientRequestId: " request-1 "
  });

  assert.equal(result.created, true);
  assert.equal(result.run.prompt, "내일 회의 일정 만들어줘");
  assert.equal(result.run.timezone, "Asia/Seoul");
  assert.equal(result.run.clientRequestId, "request-1");
  assert.equal(state.runs.length, 1);
  assert.equal(state.threads.length, 1);
  assert.equal(state.runs[0].thread_id, THREAD_ID);
  assert.equal(state.logs[0].event_type, "run_created");
  assert.deepEqual(state.outbox, [
    {
      run_id: RUN_ID,
      workspace_id: WORKSPACE_ID,
      status: "pending"
    }
  ]);
  assert.equal(state.lastLogResourceRefsParameter, "[]");
  assert.deepEqual(workspaceService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID }
  ]);
}

{
  const state = {
    runs: [],
    steps: [],
    logs: [],
    threads: [
      {
        id: THREAD_ID,
        workspace_id: WORKSPACE_ID,
        requested_by_user_id: USER_ID,
        last_activity_at: CREATED_AT
      }
    ]
  };
  const { service } = createService(state);
  await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "지난 회의록 이어서 알려줘"
  });

  assert.equal(state.threads.length, 2);
  assert.equal(state.runs[0].thread_id, "new-thread-id");
}

{
  const state = {
    runs: [
      createRun({
        client_request_id: "request-1",
        prompt: "내일 회의 일정 만들어줘",
        timezone: "Asia/Seoul"
      })
    ],
    steps: [],
    logs: []
  };
  const { service } = createService(state);
  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "내일 회의 일정 만들어줘",
    timezone: "Asia/Seoul",
    clientRequestId: "request-1"
  });

  assert.equal(result.created, false);
  assert.equal(result.run.id, RUN_ID);
  assert.equal(state.logs.length, 0);
}

{
  const state = {
    runs: [createRun({ status: "running" })],
    steps: [],
    logs: [],
    messages: []
  };
  const { service } = createService(state);

  const run = await service.waitForUserInput(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    message: "몇 시에 시작할까요?"
  });

  assert.equal(run.status, "waiting_user_input");
  assert.equal(run.finalAnswer, null);
  assert.deepEqual(state.messages, [
    {
      run_id: RUN_ID,
      sequence: 1,
      role: "assistant",
      content: "몇 시에 시작할까요?"
    }
  ]);
}

{
  const state = {
    runs: [createRun({ status: "running", tool_call_count: 0 })],
    steps: [],
    logs: [],
    outbox: [
      {
        id: "outbox-1",
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        status: "delivered",
        turn_sequence: 1,
        reason: "run_created"
      }
    ]
  };
  const { service } = createService(state);

  const run = await service.queueNextPlannerTurn(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    riskLevel: "low"
  });

  assert.equal(run.status, "planning");
  assert.equal(state.outbox[0].turn_sequence, 2);
  assert.equal(state.outbox[0].reason, "tool_result");
}

{
  const state = {
    runs: [createRun({ status: "running", tool_call_count: 0 })],
    steps: [createStep()],
    logs: [],
    messages: [],
    outbox: [
      {
        id: "outbox-1",
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        status: "delivered",
        turn_sequence: 1,
        reason: "run_created"
      }
    ]
  };
  const { service, database } = createService(state);

  const result = await service.completeToolStepAndAdvance(
    USER_ID,
    WORKSPACE_ID,
    {
      runId: RUN_ID,
      stepId: STEP_ID,
      riskLevel: "low",
      outputSummary: { count: 1 },
      resourceRefs: [],
      waitingMessage: "계속 진행할 내용을 알려주세요."
    }
  );

  assert.equal(database.transactionCount, 1);
  assert.equal(result.step.status, "completed");
  assert.equal(result.run.status, "planning");
  assert.equal(result.queuedNextPlannerTurn, true);
  assert.equal(state.runs[0].tool_call_count, 1);
  assert.equal(state.outbox[0].status, "pending");
  assert.equal(state.outbox[0].turn_sequence, 2);
  assert.equal(state.outbox[0].reason, "tool_result");
  assert.equal(state.logs[0].event_type, "step_completed");
  assert.deepEqual(state.messages, []);
}

{
  const state = {
    runs: [createRun({ status: "running", tool_call_count: 0 })],
    steps: [createStep()],
    logs: [],
    messages: [],
    outbox: []
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.completeToolStepAndAdvance(USER_ID, WORKSPACE_ID, {
        runId: RUN_ID,
        stepId: STEP_ID,
        outputSummary: { count: 1 },
        resourceRefs: [],
        waitingMessage: "계속 진행할 내용을 알려주세요."
      }),
    /outbox could not be re-armed/
  );

  assert.equal(state.steps[0].status, "running");
  assert.equal(state.runs[0].status, "running");
  assert.equal(state.runs[0].tool_call_count, 0);
  assert.deepEqual(state.logs, []);
}

{
  const state = {
    runs: [createRun({ status: "running", tool_call_count: 4 })],
    steps: [createStep()],
    logs: [],
    messages: [],
    outbox: [
      {
        id: "outbox-1",
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        status: "delivered",
        turn_sequence: 5,
        reason: "tool_result"
      }
    ]
  };
  const { service } = createService(state);

  const result = await service.completeToolStepAndAdvance(
    USER_ID,
    WORKSPACE_ID,
    {
      runId: RUN_ID,
      stepId: STEP_ID,
      outputSummary: { count: 1 },
      resourceRefs: [],
      waitingMessage: "한 요청에서 실행할 수 있는 작업은 최대 5회입니다."
    }
  );

  assert.equal(result.queuedNextPlannerTurn, false);
  assert.equal(result.run.status, "waiting_user_input");
  assert.equal(state.runs[0].tool_call_count, 5);
  assert.equal(state.outbox[0].status, "delivered");
  assert.equal(state.outbox[0].turn_sequence, 5);
  assert.equal(state.messages[0].role, "assistant");
  assert.match(state.messages[0].content, /최대 5회/);
}

{
  const state = {
    runs: [createRun({ status: "running", tool_call_count: 2 })],
    steps: [createStep()],
    logs: [],
    messages: [],
    outbox: [
      {
        id: "outbox-1",
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        status: "delivered",
        turn_sequence: 3,
        reason: "tool_result"
      }
    ]
  };
  const { service } = createService(state);

  const result = await service.completeToolStepAndAdvance(
    USER_ID,
    WORKSPACE_ID,
    {
      runId: RUN_ID,
      stepId: STEP_ID,
      outputSummary: {
        selection: "multiple",
        candidates: [
          {
            selectionToken: "77777777-7777-4777-8777-777777777777",
            title: "주문 ERD"
          }
        ]
      },
      resourceRefs: [],
      waitingMessage: "어느 일정을 선택할까요?",
      waitForUserInput: true
    }
  );

  assert.equal(result.step.status, "completed");
  assert.equal(
    result.step.outputSummary.candidates[0].selectionToken,
    "77777777-7777-4777-8777-777777777777"
  );
  assert.equal(result.run.status, "waiting_user_input");
  assert.equal(result.queuedNextPlannerTurn, false);
  assert.equal(state.runs[0].tool_call_count, 2);
  assert.equal(state.outbox[0].status, "delivered");
  assert.equal(state.outbox[0].turn_sequence, 3);
  assert.deepEqual(state.messages, [
    {
      run_id: RUN_ID,
      sequence: 1,
      role: "assistant",
      content: "어느 일정을 선택할까요?"
    }
  ]);
}

{
  const state = {
    runs: [
      createRun({
        client_request_id: "request-1",
        prompt: "내일 회의 일정 만들어줘",
        timezone: "Asia/Seoul"
      })
    ],
    steps: [],
    logs: [],
    clientRequestMissesRemaining: 1,
    insertRunConflict: true
  };
  const { service } = createService(state);
  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "내일 회의 일정 만들어줘",
    timezone: "Asia/Seoul",
    clientRequestId: "request-1"
  });

  assert.equal(result.created, false);
  assert.equal(result.run.id, RUN_ID);
  assert.equal(state.runs.length, 1);
  assert.equal(state.logs.length, 0);
}

{
  const state = {
    runs: [
      createRun({
        client_request_id: "request-1",
        prompt: "내일 회의 일정 만들어줘",
        timezone: "Asia/Seoul"
      })
    ],
    steps: [],
    logs: [],
    clientRequestMissesRemaining: 1,
    insertRunConflict: true
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.createRun(USER_ID, WORKSPACE_ID, {
        prompt: "다른 요청",
        timezone: "Asia/Seoul",
        clientRequestId: "request-1"
      }),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(errorCode(error), "CLIENT_REQUEST_ID_CONFLICT");
      return true;
    }
  );
  assert.equal(state.runs.length, 1);
  assert.equal(state.logs.length, 0);
}

{
  const state = {
    runs: [
      createRun({
        client_request_id: "request-1",
        prompt: "내일 회의 일정 만들어줘",
        timezone: "Asia/Seoul"
      })
    ],
    steps: [],
    logs: []
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.createRun(USER_ID, WORKSPACE_ID, {
        prompt: "다른 요청",
        timezone: "Asia/Seoul",
        clientRequestId: "request-1"
      }),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(errorCode(error), "CLIENT_REQUEST_ID_CONFLICT");
      return true;
    }
  );
}

{
  const requestContext = {
    surface: "pr_review",
    sessionId: PR_REVIEW_SESSION_ID
  };
  const state = {
    runs: [],
    steps: [],
    logs: []
  };
  const { service } = createService(state);

  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: "Create an orders schema",
    clientRequestId: "request-with-context",
    requestContext
  });

  assert.equal(result.created, true);
  assert.deepEqual(result.run.requestContext, requestContext);
  assert.deepEqual(state.runs[0].request_context_json, requestContext);
}

{
  const state = {
    runs: [
      createRun({
        client_request_id: "request-1",
        request_context_json: {
          sessionId: PR_REVIEW_SESSION_ID,
          surface: "pr_review"
        }
      })
    ],
    steps: [],
    logs: []
  };
  const { service } = createService(state);

  const result = await service.createRun(USER_ID, WORKSPACE_ID, {
    prompt: state.runs[0].prompt,
    timezone: state.runs[0].timezone,
    clientRequestId: "request-1",
    requestContext: {
      surface: "pr_review",
      sessionId: PR_REVIEW_SESSION_ID
    }
  });

  assert.equal(result.created, false);
  assert.equal(result.run.id, RUN_ID);
}

{
  const state = {
    runs: [
      createRun({
        client_request_id: "request-1",
        request_context_json: {
          surface: "sql_erd",
          sessionId: SQL_ERD_SESSION_ID
        }
      })
    ],
    steps: [],
    logs: []
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.createRun(USER_ID, WORKSPACE_ID, {
        prompt: state.runs[0].prompt,
        timezone: state.runs[0].timezone,
        clientRequestId: "request-1",
        requestContext: null
      }),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(errorCode(error), "CLIENT_REQUEST_ID_CONFLICT");
      return true;
    }
  );
}

{
  const state = {
    runs: [createRun()],
    steps: [],
    logs: []
  };
  const { service } = createService(state);
  const step = await service.startStep(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    order: 1,
    type: "tool",
    toolName: "list_calendar_events",
    riskLevel: "low",
    inputSummary: {
      dateRange: "2026-07-08"
    }
  });

  assert.equal(step.status, "running");
  assert.deepEqual(step.inputSummary, { dateRange: "2026-07-08" });
  assert.equal(state.steps.length, 1);
  assert.equal(state.logs[0].event_type, "step_started");
}

{
  const state = {
    runs: [createRun()],
    steps: [],
    logs: []
  };
  const { service } = createService(state);
  const step = await service.startNextToolStepIfAbsent(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    toolName: "list_calendar_events",
    riskLevel: "low",
    inputSummary: {
      dateRange: "2026-07-08"
    }
  });

  assert.equal(step.status, "running");
  assert.equal(step.order, 1);
  assert.equal(step.type, "tool");
  assert.equal(state.steps.length, 1);
  assert.equal(state.logs[0].event_type, "step_started");
}

{
  const state = {
    runs: [createRun()],
    steps: [createStep()],
    logs: []
  };
  const { service } = createService(state);
  const step = await service.startNextToolStepIfAbsent(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    toolName: "list_calendar_events",
    riskLevel: "low",
    inputSummary: {
      dateRange: "2026-07-08"
    }
  });

  assert.equal(step, null);
  assert.equal(state.steps.length, 1);
  assert.equal(state.logs.length, 0);
}

{
  const state = {
    runs: [createRun()],
    steps: [createStep()],
    logs: []
  };
  const { service } = createService(state);
  const resourceRefs = [
    {
      domain: "calendar",
      resourceType: "event",
      resourceId: "event-1",
      label: "주간 회의"
    }
  ];
  const step = await service.completeStep(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    stepId: STEP_ID,
    outputSummary: {
      count: 1
    },
    resourceRefs
  });

  assert.equal(step.status, "completed");
  assert.equal(step.outputSummary.count, 1);
  assert.equal(step.resourceRefs[0].resourceId, "event-1");
  assert.equal(
    state.lastStepResourceRefsParameter,
    JSON.stringify(resourceRefs)
  );
  assert.equal(state.logs[0].event_type, "step_completed");
  assert.equal(state.lastLogResourceRefsParameter, JSON.stringify(resourceRefs));
  assert.equal(state.logs[0].resource_refs[0].label, "주간 회의");
}

{
  const state = {
    runs: [createRun()],
    steps: [createStep()],
    logs: []
  };
  const { service } = createService(state);
  const step = await service.failStep(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    stepId: STEP_ID,
    errorCode: "TOOL_FAILED",
    errorMessage: "도구 실행에 실패했습니다."
  });

  assert.equal(step.status, "failed");
  assert.equal(step.errorCode, "TOOL_FAILED");
  assert.equal(state.logs[0].event_type, "step_failed");
  assert.equal(state.logs[0].level, "error");
}

{
  const state = {
    runs: [createRun({ status: "planning" })],
    steps: [
      createStep({
        status: "completed",
        output_json: { count: 1 },
        completed_at: new Date("2026-07-08T00:02:00.000Z")
      })
    ],
    logs: []
  };
  const { service } = createService(state);

  const step = await service.failStep(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    stepId: STEP_ID,
    errorCode: "AMBIGUOUS_COMMIT",
    errorMessage: "Commit 결과를 확인하지 못했습니다."
  });

  assert.equal(step.status, "completed");
  assert.deepEqual(step.outputSummary, { count: 1 });
  assert.equal(state.steps[0].status, "completed");
  assert.equal(state.steps[0].error_code, null);
  assert.deepEqual(state.logs, []);
}

{
  const state = {
    runs: [createRun({ status: "running" })],
    steps: [],
    logs: []
  };
  const { service } = createService(state);
  const run = await service.completeRun(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    finalAnswer: "일정을 확인했습니다.",
    riskLevel: "low"
  });

  assert.equal(run.status, "completed");
  assert.equal(run.finalAnswer, "일정을 확인했습니다.");
  assert.equal(run.riskLevel, "low");
  assert.equal(state.logs[0].event_type, "run_completed");
}

{
  const state = {
    runs: [createRun({ status: "running" })],
    steps: [],
    logs: []
  };
  const { service } = createService(state);
  const run = await service.failRun(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    errorCode: "AGENT_FAILED",
    errorMessage: "요청을 처리하지 못했습니다."
  });

  assert.equal(run.status, "failed");
  assert.equal(run.errorCode, "AGENT_FAILED");
  assert.equal(state.logs[0].event_type, "run_failed");
}

{
  const state = {
    runs: [createRun()],
    steps: [],
    logs: []
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.startStep(USER_ID, WORKSPACE_ID, {
        runId: RUN_ID,
        order: 1,
        type: "tool",
        inputSummary: {
          providerRaw: {
            token: "must-not-store"
          }
        }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(errorMessage(error), /forbidden key: providerRaw/);
      return true;
    }
  );
  await assert.rejects(
    () =>
      service.startStep(USER_ID, WORKSPACE_ID, {
        runId: RUN_ID,
        order: 1,
        type: "tool",
        inputSummary: {
          selectionToken: "must-not-store"
        }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(errorMessage(error), /forbidden key: selectionToken/);
      return true;
    }
  );
  assert.equal(state.steps.length, 0);
  assert.equal(state.logs.length, 0);
}
