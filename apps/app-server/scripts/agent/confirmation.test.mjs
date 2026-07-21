import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentConfirmationService } = require(
  "../../dist/modules/agent/agent-confirmation.service.js"
);
const { badRequest } = require("../../dist/common/api-error.js");
const { boardBadGateway } = require(
  "../../dist/modules/board/board-api-error.js"
);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const CONFIRMATION_ID = "44444444-4444-4444-4444-444444444444";
const STEP_ID = "55555555-5555-5555-5555-555555555555";
const SQL_ERD_SESSION_ID = "77777777-7777-4777-8777-777777777777";

function createPlan(toolName = "create_calendar_event") {
  return {
    toolName,
    summary: "주간 회의 일정을 생성합니다.",
    target: {
      domain: "calendar",
      resourceType: "event"
    },
    before: null,
    after: {
      title: "주간 회의",
      description: null,
      color: "#3B82F6",
      isAllDay: false,
      startDate: "2026-07-08",
      endDate: "2026-07-08",
      startTime: "15:00",
      endTime: null
    },
    call: {
      method: "POST",
      path: "/api/v1/workspaces/{workspaceId}/calendar/events",
      body: {
        title: "주간 회의",
        description: null,
        color: "#3B82F6",
        isAllDay: false,
        startDate: "2026-07-08",
        endDate: "2026-07-08",
        startTime: "15:00",
        endTime: null
      }
    }
  };
}

function createUpdatePlan() {
  return {
    toolName: "update_calendar_event",
    summary: "주간 회의 일정을 수정합니다.",
    target: {
      domain: "calendar",
      resourceType: "event",
      resourceId: "77",
      label: "주간 회의"
    },
    before: {
      title: "주간 회의",
      startDate: "2026-07-08",
      startTime: "15:00"
    },
    after: {
      title: "변경된 회의",
      startTime: "16:00"
    },
    call: {
      method: "PATCH",
      path: "/api/v1/workspaces/{workspaceId}/calendar/events/77",
      eventId: "77",
      body: {
        title: "변경된 회의",
        startTime: "16:00"
      }
    }
  };
}

function createChoicePlan() {
  return {
    kind: "choice",
    toolName: "contextual_schema_fixture",
    summary: "Choose where to create the schema",
    target: {
      domain: "sql_erd"
    },
    call: {
      action: "generate_schema"
    },
    choices: [
      {
        id: "new_session",
        label: "Create new session",
        input: {
          mode: "new_session"
        }
      },
      {
        id: "replace_schema",
        label: "Replace current schema",
        input: {
          mode: "replace_schema"
        }
      }
    ]
  };
}

function createRun(overrides = {}) {
  return {
    id: RUN_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    status: "waiting_confirmation",
    message: null,
    completed_at: null,
    request_context_json: null,
    ...overrides
  };
}

function createConfirmation(overrides = {}) {
  const now = new Date("2026-07-08T00:00:00.000Z");

  return {
    id: CONFIRMATION_ID,
    run_id: RUN_ID,
    tool_name: "create_calendar_event",
    status: "pending",
    risk_level: "medium",
    summary: "주간 회의 일정을 생성합니다.",
    plan_json: createPlan(),
    expires_at: new Date("2999-01-01T00:00:00.000Z"),
    approved_by_user_id: null,
    rejected_by_user_id: null,
    approved_at: null,
    rejected_at: null,
    selected_choice_id: null,
    created_at: now,
    updated_at: now,
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

class FakeDatabaseService {
  constructor(state) {
    this.state = state;
  }

  async transaction(callback) {
    return callback(new FakeTransaction(this.state));
  }

  async query(text) {
    if (text.includes("SELECT DISTINCT tool_name")) {
      return (this.state.completedToolNames ?? []).map((tool_name) => ({
        tool_name
      }));
    }
    if (text.includes("execution_lease_expires_at <= now()")) {
      return this.state.staleExecutions ?? [];
    }

    throw new Error(`Unhandled query: ${text}`);
  }

  async queryOne(text) {
    if (text.includes("step_type = 'planner'")) {
      return this.state.latestPlannerStep ?? null;
    }
    throw new Error(`Unhandled queryOne: ${text}`);
  }
}

class FakeAgentLoggingService {
  constructor(state) {
    this.state = state;
    this.calls = [];
  }

  async createToolExecutionClaim(transaction, workspaceId, input) {
    this.calls.push({
      method: "createToolExecutionClaim",
      transaction,
      workspaceId,
      input
    });

    return {
      step: {
        id: STEP_ID,
        runId: input.runId,
        status: "running"
      },
      lease: {
        token: "66666666-6666-4666-8666-666666666666",
        generation: 1
      }
    };
  }


  async heartbeatExecutionLease() {
    return true;
  }

  async completeStep(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "completeStep",
      currentUserId,
      workspaceId,
      input
    });

    return {
      id: input.stepId,
      runId: input.runId,
      status: "completed"
    };
  }

  async completeToolStepAndAdvance(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "completeToolStepAndAdvance",
      currentUserId,
      workspaceId,
      input
    });

    const run = this.state.runs.find((candidate) => candidate.id === input.runId);
    const disposition = input.postExecutionDisposition ?? "continue_planning";
    const queuedNextPlannerTurn =
      disposition === "continue_planning" &&
      this.state.toolCallLimitReached !== true;
    run.status = disposition === "complete_run"
      ? "completed"
      : queuedNextPlannerTurn
        ? "planning"
        : "waiting_user_input";
    run.message = queuedNextPlannerTurn
      ? "다음 작업을 확인하고 있습니다."
      : input.waitingMessage;

    return {
      step: {
        id: input.stepId,
        runId: input.runId,
        status: "completed"
      },
      run: {
        id: run.id,
        status: run.status,
        message: run.message
      },
      queuedNextPlannerTurn
    };
  }

  async failStep(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "failStep",
      currentUserId,
      workspaceId,
      input
    });

    return {
      id: input.stepId,
      runId: input.runId,
      status: "failed"
    };
  }

  async queueNextPlannerTurn(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "queueNextPlannerTurn",
      currentUserId,
      workspaceId,
      input
    });

    if (this.state.queueNextPlannerTurn === false) {
      return null;
    }
    const run = this.state.runs.find((candidate) => candidate.id === input.runId);
    run.status = "planning";
    run.message = "다음 작업을 계획하고 있습니다.";

    return {
      id: run.id,
      status: run.status,
      message: run.message
    };
  }

  async waitForUserInput(currentUserId, workspaceId, input) {
    this.calls.push({ method: "waitForUserInput", currentUserId, workspaceId, input });
    const run = this.state.runs.find((candidate) => candidate.id === input.runId);
    run.status = "waiting_user_input";
    run.message = input.message;
    return { id: run.id, status: run.status, message: run.message };
  }

  async failRun(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "failRun",
      currentUserId,
      workspaceId,
      input
    });

    const run = this.state.runs.find((candidate) => candidate.id === input.runId);
    run.status = "failed";
    run.message = input.message;

    return {
      id: run.id,
      status: run.status,
      message: run.message
    };
  }
}

class FakeAgentToolRegistryService {
  constructor(state) {
    this.state = state;
    this.calls = [];
  }

  getDefinition(name) {
    this.calls.push({
      method: "getDefinition",
      name
    });

    if (this.state.missingTool) {
      return null;
    }

    return {
      name: this.state.definitionName ?? name,
      riskLevel: this.state.definitionRiskLevel ?? "medium",
      executionMode:
        this.state.definitionExecutionMode ?? "confirmation_required",
      postExecutionDisposition: this.state.definitionPostExecutionDisposition,
      validateInput: (input) => {
        this.calls.push({
          method: "validateInput",
          name,
          input
        });

        if (this.state.validationError) {
          throw this.state.validationError;
        }

        return input;
      },
      ...(this.state.buildConfirmationInput
        ? {
            buildConfirmationInput: (plan, selectedChoiceId) => {
              this.calls.push({
                method: "buildConfirmationInput",
                name,
                plan,
                selectedChoiceId
              });
              return this.state.buildConfirmationInput(plan, selectedChoiceId);
            },
            validateConfirmationInput: (input) => {
              this.calls.push({
                method: "validateConfirmationInput",
                name,
                input
              });
              return input;
            }
          }
        : {}),
      execute: async (context, input) => {
        this.calls.push({
          method: "execute",
          name,
          context,
          input
        });

        if (this.state.executionError) {
          throw this.state.executionError;
        }

        return {
          outputSummary: {
            action: "created",
            transcriptText: "must-not-leak",
            nested: {
              visible: "ok",
              token: "must-not-leak"
            },
            ...(this.state.outputSummary ?? {})
          },
          resourceRefs: [
            {
              domain: "calendar",
              resourceType: "event",
              resourceId: "1",
              label: "주간 회의",
              metadata: {
                token: "must-not-leak",
                visible: "ok"
              }
            }
          ]
        };
      }
    };
  }

  getDefinitionForContext(name) {
    return this.getDefinition(name);
  }
}

class FakeAgentOutboxPublisherService {
  constructor(error = null) {
    this.calls = [];
    this.error = error;
  }

  async publishCreatedRun(runId) {
    this.calls.push(runId);
    if (this.error) throw this.error;
  }
}

class FakeTransaction {
  constructor(state) {
    this.state = state;
  }

  async queryOne(text, values = []) {
    if (
      text.includes("r.execution_lease_token = $2::uuid") &&
      text.includes("FOR UPDATE OF r")
    ) {
      return this.findStaleExecution(values);
    }

    if (text.includes("UPDATE agent_steps") && text.includes("AGENT_EXECUTION_STALE")) {
      return { id: values[0] };
    }

    if (
      text.includes("UPDATE agent_runs") &&
      text.includes("AGENT_EXECUTION_STALE")
    ) {
      const run = this.state.runs.find((candidate) => candidate.id === values[0]);
      if (!run || run.status !== "running") {
        return null;
      }
      run.status = "failed";
      run.message = "작업이 시간 안에 완료되지 않아 실행을 종료했습니다.";
      return { id: run.id };
    }

    if (text.includes("INSERT INTO agent_confirmations")) {
      return this.insertConfirmation(values);
    }

    if (text.includes("UPDATE agent_runs")) {
      return this.updateRun(values);
    }

    if (text.includes("UPDATE agent_confirmations")) {
      return this.updateConfirmation(text, values);
    }

    if (text.includes("FROM agent_confirmations c")) {
      return this.findConfirmationForUpdate(values);
    }

    if (
      text.includes("SELECT *") &&
      text.includes("FROM agent_confirmations") &&
      text.includes("WHERE id = $1")
    ) {
      const confirmation = this.state.confirmations.find(
        (candidate) =>
          candidate.id === values[0] && candidate.run_id === values[1]
      );
      return confirmation ? { ...confirmation } : null;
    }

    if (text.includes("FROM agent_confirmations")) {
      return this.findPendingConfirmation(values);
    }

    if (text.includes("FROM agent_runs")) {
      return this.findRun(values);
    }

    throw new Error(`Unhandled queryOne: ${text}`);
  }

  async execute(text, values = []) {
    if (text.includes("UPDATE agent_confirmations")) {
      this.updateConfirmation(text, values);
      return {
        rowCount: 1,
        rows: []
      };
    }

    throw new Error(`Unhandled execute: ${text}`);
  }

  findRun([runId, workspaceId, currentUserId]) {
    const run = this.state.runs.find(
      (candidate) =>
        candidate.id === runId &&
        candidate.workspace_id === workspaceId &&
        candidate.requested_by_user_id === currentUserId
    );

    return run ? { ...run } : null;
  }

  findPendingConfirmation([runId]) {
    const confirmation = this.state.confirmations.find(
      (candidate) => candidate.run_id === runId && candidate.status === "pending"
    );

    return confirmation ? { id: confirmation.id } : null;
  }

  findConfirmationForUpdate([
    confirmationId,
    runId,
    workspaceId,
    currentUserId
  ]) {
    const run = this.state.runs.find(
      (candidate) =>
        candidate.id === runId &&
        candidate.workspace_id === workspaceId &&
        candidate.requested_by_user_id === currentUserId
    );
    const confirmation = this.state.confirmations.find(
      (candidate) => candidate.id === confirmationId && candidate.run_id === runId
    );

    if (!run || !confirmation) {
      return null;
    }

    return {
      ...confirmation,
      run_status: run.status,
      run_message: run.message,
      run_request_context_json: run.request_context_json ?? null
    };
  }

  findStaleExecution([runId]) {
    const stale = this.state.staleExecutions?.find(
      (candidate) => candidate.run_id === runId
    );
    return stale ? { ...stale } : null;
  }

  insertConfirmation([
    runId,
    toolName,
    riskLevel,
    summary,
    plan,
    expiresAt
  ]) {
    const now = new Date("2026-07-08T00:00:00.000Z");
    const id =
      this.state.confirmations.length === 0
        ? CONFIRMATION_ID
        : "66666666-6666-6666-6666-666666666666";
    const confirmation = {
      id,
      run_id: runId,
      tool_name: toolName,
      status: "pending",
      risk_level: riskLevel,
      summary,
      plan_json: plan,
      expires_at: expiresAt,
      approved_by_user_id: null,
      rejected_by_user_id: null,
      approved_at: null,
      rejected_at: null,
      selected_choice_id: null,
      created_at: now,
      updated_at: now
    };

    this.state.confirmations.push(confirmation);
    return { ...confirmation };
  }

  updateRun([runId, status, message, completed]) {
    const run = this.state.runs.find((candidate) => candidate.id === runId);

    if (!run) {
      return null;
    }

    run.status = status;
    run.message = message;

    if (completed) {
      run.completed_at = new Date("2026-07-08T00:05:00.000Z");
    }

    return {
      id: run.id,
      status: run.status,
      message: run.message
    };
  }

  updateConfirmation(text, [confirmationId, userId, selectedChoiceId]) {
    const confirmation = this.state.confirmations.find(
      (candidate) => candidate.id === confirmationId
    );

    if (!confirmation) {
      return null;
    }

    if (text.includes("status = 'approved'")) {
      confirmation.status = "approved";
      confirmation.approved_by_user_id = userId;
      confirmation.approved_at = new Date("2026-07-08T00:03:00.000Z");
      confirmation.selected_choice_id = selectedChoiceId ?? null;
    } else if (text.includes("status = 'rejected'")) {
      confirmation.status = "rejected";
      confirmation.rejected_by_user_id = userId;
      confirmation.rejected_at = new Date("2026-07-08T00:04:00.000Z");
    } else if (text.includes("status = 'expired'")) {
      confirmation.status = "expired";
    }

    return { ...confirmation };
  }
}

function createService(state) {
  const workspaceService = new FakeWorkspaceService();
  const database = new FakeDatabaseService(state);
  const loggingService = new FakeAgentLoggingService(state);
  const toolRegistryService = new FakeAgentToolRegistryService(state);
  const outboxPublisherService = new FakeAgentOutboxPublisherService(
    state.publisherError ?? null
  );

  return {
    service: new AgentConfirmationService(
      database,
      workspaceService,
      loggingService,
      toolRegistryService,
      outboxPublisherService
    ),
    workspaceService,
    loggingService,
    toolRegistryService,
    outboxPublisherService
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
    runs: [createRun({ status: "planning" })],
    confirmations: []
  };
  const { service } = createService(state);
  const plan = createPlan();
  const result = await service.createConfirmation(USER_ID, WORKSPACE_ID, {
    runId: RUN_ID,
    toolName: "create_calendar_event",
    riskLevel: "medium",
    summary: plan.summary,
    plan,
    expiresAt: new Date("2999-01-01T00:00:00.000Z")
  });

  assert.equal(result.status, "pending");
  assert.deepEqual(result.plan, plan);
  assert.equal(state.confirmations[0].plan_json, plan);
  assert.equal(state.runs[0].status, "waiting_confirmation");
}

{
  const state = {
    runs: [createRun({ status: "running" })],
    confirmations: [createConfirmation({ status: "approved" })],
    staleExecutions: [
      {
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        requested_by_user_id: USER_ID,
        tool_step_id: STEP_ID,
        tool_step_status: "running",
        execution_lease_token: "66666666-6666-4666-8666-666666666666",
        execution_lease_generation: 1
      }
    ]
  };
  const { service, loggingService, toolRegistryService } = createService(state);
  const recovered = await service.recoverStaleApprovedExecutions();

  assert.equal(recovered, 1);
  assert.deepEqual(loggingService.calls, []);
  assert.equal(state.runs[0].status, "failed");
  assert.deepEqual(toolRegistryService.calls, []);
}

{
  const state = {
    runs: [
      createRun({
        request_context_json: {
          surface: "sql_erd",
          sessionId: SQL_ERD_SESSION_ID
        }
      })
    ],
    confirmations: [createConfirmation()],
    latestPlannerStep: {
      output_json: {
        toolRetrieval: {
          mode: "shadow",
          capabilityIds: ["calendar.events.create"]
        }
      }
    }
  };
  const {
    service,
    workspaceService,
    loggingService,
    toolRegistryService,
    outboxPublisherService
  } = createService(state);
  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.confirmation.status, "approved");
  assert.equal(result.run.confirmation.approvedAt, "2026-07-08T00:03:00.000Z");
  assert.equal(result.run.confirmation.selectedChoiceId, null);
  assert.equal(state.confirmations[0].approved_by_user_id, USER_ID);
  assert.match(state.runs[0].message, /create_calendar_event 실행을 완료했습니다/);
  assert.equal(workspaceService.calls.length, 1);
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["createToolExecutionClaim", "completeToolStepAndAdvance"]
  );
  assert.deepEqual(outboxPublisherService.calls, []);
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition", "validateInput", "execute"]
  );
  assert.equal(toolRegistryService.calls[2].input.title, "주간 회의");
  assert.equal(
    "transcriptText" in loggingService.calls[1].input.outputSummary,
    false
  );
  assert.equal(loggingService.calls[1].input.outputSummary.nested.visible, "ok");
  assert.equal(
    "token" in loggingService.calls[1].input.outputSummary.nested,
    false
  );
  assert.equal(
    "token" in loggingService.calls[1].input.resourceRefs[0].metadata,
    false
  );
  assert.equal(loggingService.calls[1].input.riskLevel, "medium");
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()],
    toolCallLimitReached: true
  };
  const { service, loggingService, outboxPublisherService } = createService(state);

  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "waiting_user_input");
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["createToolExecutionClaim", "completeToolStepAndAdvance"]
  );
  assert.deepEqual(outboxPublisherService.calls, []);
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()],
    publisherError: new Error("SQS publish failed")
  };
  const { service, loggingService, outboxPublisherService } = createService(state);

  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "planning");
  assert.deepEqual(outboxPublisherService.calls, [RUN_ID]);
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["createToolExecutionClaim", "completeToolStepAndAdvance"]
  );
  assert.equal(
    loggingService.calls.some(
      (call) => call.method === "failStep" || call.method === "failRun"
    ),
    false
  );
}

{
  const choicePlan = createChoicePlan();
  choicePlan.choices[1].id = choicePlan.choices[0].id;
  const state = {
    runs: [createRun({ status: "planning" })],
    confirmations: []
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.createConfirmation(USER_ID, WORKSPACE_ID, {
        runId: RUN_ID,
        toolName: "contextual_schema_fixture",
        riskLevel: "medium",
        summary: choicePlan.summary,
        plan: choicePlan
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(
        errorMessage(error),
        "Confirmation plan choices are not executable"
      );
      return true;
    }
  );
  assert.equal(state.confirmations.length, 0);
}

{
  const choicePlan = createChoicePlan();
  choicePlan.choices[0].id = "가".repeat(43);
  const state = {
    runs: [createRun({ status: "planning" })],
    confirmations: []
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.createConfirmation(USER_ID, WORKSPACE_ID, {
        runId: RUN_ID,
        toolName: "contextual_schema_fixture",
        riskLevel: "medium",
        summary: choicePlan.summary,
        plan: choicePlan
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(
        errorMessage(error),
        "Confirmation plan choices are not executable"
      );
      return true;
    }
  );
  assert.equal(state.confirmations.length, 0);
}

{
  const choicePlan = createChoicePlan();
  const state = {
    definitionExecutionMode: "contextual",
    buildConfirmationInput: (plan, selectedChoiceId) =>
      plan.choices.find((choice) => choice.id === selectedChoiceId).input,
    runs: [
      createRun({
        request_context_json: {
          surface: "sql_erd",
          sessionId: SQL_ERD_SESSION_ID
        }
      })
    ],
    confirmations: [
      createConfirmation({
        tool_name: "contextual_schema_fixture",
        summary: choicePlan.summary,
        plan_json: choicePlan
      })
    ]
  };
  const { service, toolRegistryService } = createService(state);

  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    { choiceId: "replace_schema" }
  );

  assert.equal(result.run.status, "planning");
  assert.equal(result.run.confirmation.selectedChoiceId, "replace_schema");
  assert.equal(state.confirmations[0].selected_choice_id, "replace_schema");
  assert.equal(
    toolRegistryService.calls.find(
      (call) => call.method === "buildConfirmationInput"
    ).selectedChoiceId,
    "replace_schema"
  );
  assert.deepEqual(
    toolRegistryService.calls.find((call) => call.method === "execute").input,
    { mode: "replace_schema" }
  );
  assert.deepEqual(
    toolRegistryService.calls.find((call) => call.method === "execute").context
      .requestContext,
    {
      surface: "sql_erd",
      sessionId: SQL_ERD_SESSION_ID
    }
  );
}

for (const body of [undefined, {}, { choiceId: "unknown" }]) {
  const choicePlan = createChoicePlan();
  const state = {
    definitionExecutionMode: "contextual",
    buildConfirmationInput: (plan, selectedChoiceId) =>
      plan.choices.find((choice) => choice.id === selectedChoiceId)?.input,
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        tool_name: "contextual_schema_fixture",
        summary: choicePlan.summary,
        plan_json: choicePlan
      })
    ]
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.approveConfirmation(
        USER_ID,
        WORKSPACE_ID,
        RUN_ID,
        CONFIRMATION_ID,
        body
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorMessage(error), "choiceId must select an available choice");
      return true;
    }
  );
  assert.equal(state.confirmations[0].status, "pending");
  assert.equal(state.confirmations[0].selected_choice_id, null);
}

{
  const updatePlan = createUpdatePlan();
  const state = {
    definitionPostExecutionDisposition: "complete_run",
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        tool_name: "update_calendar_event",
        summary: updatePlan.summary,
        plan_json: updatePlan
      })
    ]
  };
  const { service, toolRegistryService, loggingService, outboxPublisherService } =
    createService(state);
  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.confirmation.status, "approved");
  assert.equal(
    loggingService.calls.at(-1).input.postExecutionDisposition,
    "complete_run"
  );
  assert.deepEqual(outboxPublisherService.calls, []);
  assert.deepEqual(toolRegistryService.calls[2].input, {
    eventId: "77",
    changes: {
      title: "변경된 회의",
      startTime: "16:00"
    }
  });
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()]
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.approveConfirmation(
        USER_ID,
        WORKSPACE_ID,
        RUN_ID,
        CONFIRMATION_ID,
        { title: "body 값은 실행에 사용하면 안 된다" }
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.equal(errorMessage(error), "Request body must be empty");
      return true;
    }
  );
  assert.equal(state.confirmations[0].status, "pending");
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()],
    executionError: new Error("Calendar execution failed")
  };
  const { service, loggingService } = createService(state);
  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "failed");
  assert.equal(result.run.message, "승인된 작업을 실행하지 못했습니다.");
  assert.equal(result.run.confirmation.status, "approved");
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["createToolExecutionClaim", "failStep", "failRun"]
  );
  assert.equal(
    loggingService.calls[1].input.errorCode,
    "AGENT_TOOL_EXECUTION_FAILED"
  );
  assert.equal(
    loggingService.calls[2].input.errorMessage,
    "Agent tool execution failed"
  );
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()],
    executionError: badRequest("title is required")
  };
  const { service, loggingService } = createService(state);
  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "failed");
  assert.equal(
    loggingService.calls[2].input.errorMessage,
    "title is required"
  );
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()]
  };
  const { service, toolRegistryService } = createService(state);
  const result = await service.rejectConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    {}
  );

  assert.equal(result.run.status, "cancelled");
  assert.equal(result.run.confirmation.status, "rejected");
  assert.equal(result.run.confirmation.rejectedAt, "2026-07-08T00:04:00.000Z");
  assert.equal(state.confirmations[0].rejected_by_user_id, USER_ID);
  assert.deepEqual(toolRegistryService.calls, []);
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()],
    missingTool: true
  };
  const { service, loggingService, toolRegistryService } = createService(state);

  await assert.rejects(
    () =>
      service.approveConfirmation(
        USER_ID,
        WORKSPACE_ID,
        RUN_ID,
        CONFIRMATION_ID,
        undefined
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.equal(
        errorMessage(error),
        "Agent tool is not executable: create_calendar_event"
      );
      return true;
    }
  );
  assert.equal(state.confirmations[0].status, "pending");
  assert.equal(state.runs[0].status, "waiting_confirmation");
  assert.deepEqual(loggingService.calls, []);
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition"]
  );
}

{
  const state = {
    runs: [createRun()],
    confirmations: [createConfirmation()],
    definitionExecutionMode: "auto"
  };
  const { service, loggingService, toolRegistryService } = createService(state);

  await assert.rejects(
    () =>
      service.approveConfirmation(
        USER_ID,
        WORKSPACE_ID,
        RUN_ID,
        CONFIRMATION_ID,
        undefined
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.equal(
        errorMessage(error),
        "Agent tool is not executable: create_calendar_event"
      );
      return true;
    }
  );
  assert.equal(state.confirmations[0].status, "pending");
  assert.equal(state.runs[0].status, "waiting_confirmation");
  assert.deepEqual(loggingService.calls, []);
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition"]
  );
}

{
  const state = {
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        expires_at: new Date("2000-01-01T00:00:00.000Z")
      })
    ]
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.approveConfirmation(
        USER_ID,
        WORKSPACE_ID,
        RUN_ID,
        CONFIRMATION_ID,
        null
      ),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(errorCode(error), "CONFIRMATION_EXPIRED");
      return true;
    }
  );
  assert.equal(state.confirmations[0].status, "expired");
  assert.equal(state.runs[0].status, "cancelled");
}

{
  const state = {
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        status: "approved",
        approved_at: new Date("2026-07-08T00:03:00.000Z")
      })
    ]
  };
  const { service } = createService(state);

  await assert.rejects(
    () =>
      service.rejectConfirmation(
        USER_ID,
        WORKSPACE_ID,
        RUN_ID,
        CONFIRMATION_ID,
        undefined
      ),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(errorCode(error), "CONFIRMATION_NOT_PENDING");
      return true;
    }
  );
  assert.equal(state.confirmations[0].status, "approved");
}

{
  const movePlan = {
    toolName: "move_board_issue_status",
    summary: "#134 이슈를 In Progress로 이동합니다.",
    target: {
      domain: "board",
      resourceType: "issue",
      resourceId: "101"
    },
    before: { columnName: "Todo" },
    after: { columnName: "In Progress" },
    call: {
      boardId: "42",
      issueId: "101",
      columnId: "8",
      previousColumnId: "7"
    }
  };
  const state = {
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        tool_name: "move_board_issue_status",
        summary: movePlan.summary,
        plan_json: movePlan
      })
    ],
    buildConfirmationInput: (plan) => ({
      boardId: plan.call.boardId,
      issueId: plan.call.issueId,
      columnId: plan.call.columnId,
      previousColumnId: plan.call.previousColumnId
    })
  };
  const { service, toolRegistryService } = createService(state);
  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "planning");
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    [
      "getDefinition",
      "buildConfirmationInput",
      "validateConfirmationInput",
      "execute"
    ]
  );
  assert.deepEqual(toolRegistryService.calls[3].input, {
    boardId: "42",
    issueId: "101",
    columnId: "8",
    previousColumnId: "7"
  });
}

{
  const plan = {
    ...createPlan("create_board_issue"),
    summary: "Create an authentication failure issue in Todo.",
    target: {
      domain: "board",
      resourceType: "issue"
    },
    after: {
      title: "Fix authentication failure",
      body: null,
      columnName: "Todo"
    },
    call: {
      method: "POST",
      path: "/api/v1/workspaces/{workspaceId}/boards/{boardId}/issues",
      boardId: "1",
      columnId: "2",
      idempotencyKey: `agent:${RUN_ID}:create_board_issue`
    }
  };
  const state = {
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        tool_name: "create_board_issue",
        summary: plan.summary,
        plan_json: plan
      })
    ],
    executionError: boardBadGateway("GitHub ProjectV2 item add failed"),
    buildConfirmationInput: (confirmationPlan) => confirmationPlan.after
  };
  const { service, loggingService } = createService(state);

  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "waiting_confirmation");
  assert.equal(result.run.confirmation.status, "pending");
  assert.equal(state.confirmations.length, 2);
  assert.equal(state.confirmations[0].status, "approved");
  assert.equal(state.confirmations[1].status, "pending");
  assert.notEqual(state.confirmations[1].id, CONFIRMATION_ID);
  assert.deepEqual(state.confirmations[1].plan_json, plan);
  assert.equal(
    state.confirmations[1].plan_json.call.idempotencyKey,
    `agent:${RUN_ID}:create_board_issue`
  );
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["createToolExecutionClaim", "failStep"]
  );
}

{
  const plan = {
    ...createPlan("create_board_issue"),
    summary: "Create an authentication failure issue in Todo."
  };
  const state = {
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        tool_name: "create_board_issue",
        summary: plan.summary,
        plan_json: plan
      })
    ],
    executionError: badRequest("title is required"),
    buildConfirmationInput: (confirmationPlan) => confirmationPlan.after
  };
  const { service, loggingService } = createService(state);

  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "failed");
  assert.equal(state.confirmations.length, 1);
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["createToolExecutionClaim", "failStep", "failRun"]
  );
}
{
  const plan = {
    toolName: "assign_board_issue_safely",
    summary: "#134 issue assignees will be updated.",
    target: {
      domain: "board",
      resourceType: "issue",
      resourceId: "101"
    },
    before: {
      assignees: ["alice", "bob"]
    },
    after: {
      assignees: ["alice", "carol"],
      retained: ["alice"],
      added: ["carol"],
      removed: ["bob"]
    },
    call: {
      service: "BoardService.updateBoardIssueAssigneesDelta",
      boardId: "42",
      issueId: "101",
      addAssignees: ["carol"],
      removeAssignees: ["bob"]
    }
  };
  const state = {
    runs: [createRun()],
    confirmations: [
      createConfirmation({
        tool_name: "assign_board_issue_safely",
        summary: plan.summary,
        plan_json: plan
      })
    ],
    executionError: boardBadGateway("GitHub issue update failed"),
    buildConfirmationInput: (confirmationPlan) => ({
      boardId: confirmationPlan.call.boardId,
      issueId: confirmationPlan.call.issueId,
      addAssignees: confirmationPlan.call.addAssignees,
      removeAssignees: confirmationPlan.call.removeAssignees
    })
  };
  const { service } = createService(state);

  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "waiting_confirmation");
  assert.equal(state.confirmations.length, 2);
  assert.equal(state.confirmations[0].status, "approved");
  assert.equal(state.confirmations[1].status, "pending");
  assert.deepEqual(state.confirmations[1].plan_json.call, plan.call);
}
