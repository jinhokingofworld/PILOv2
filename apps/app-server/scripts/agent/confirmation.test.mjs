import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentConfirmationService } = require(
  "../../dist/modules/agent/agent-confirmation.service.js"
);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const CONFIRMATION_ID = "44444444-4444-4444-4444-444444444444";

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
      title: "주간 회의"
    },
    call: {
      method: "POST",
      path: "/api/v1/workspaces/{workspaceId}/calendar/events"
    }
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
}

class FakeTransaction {
  constructor(state) {
    this.state = state;
  }

  async queryOne(text, values = []) {
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
      run_message: run.message
    };
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
    const confirmation = {
      id: CONFIRMATION_ID,
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

  updateConfirmation(text, [confirmationId, userId]) {
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

  return {
    service: new AgentConfirmationService(database, workspaceService),
    workspaceService
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
    runs: [createRun()],
    confirmations: [createConfirmation()]
  };
  const { service, workspaceService } = createService(state);
  const result = await service.approveConfirmation(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID,
    CONFIRMATION_ID,
    undefined
  );

  assert.equal(result.run.status, "running");
  assert.equal(result.run.confirmation.status, "approved");
  assert.equal(result.run.confirmation.approvedAt, "2026-07-08T00:03:00.000Z");
  assert.equal(state.confirmations[0].approved_by_user_id, USER_ID);
  assert.equal(state.runs[0].message, "승인된 작업을 실행하고 있습니다.");
  assert.equal(workspaceService.calls.length, 1);
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
    confirmations: [createConfirmation()]
  };
  const { service } = createService(state);
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
