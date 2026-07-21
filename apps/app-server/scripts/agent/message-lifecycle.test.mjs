import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentMessageService } = require(
  "../../dist/modules/agent/agent-message.service.js"
);
const { AgentInputRelationshipUnavailableError } = require(
  "../../dist/modules/agent/agent-input-relationship.service.js"
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const THREAD_ID = "44444444-4444-4444-8444-444444444444";
const CONFIRMATION_ID = "55555555-5555-4555-8555-555555555555";

process.env.AGENT_MESSAGE_ROUTING_MODE = "intent";

function waitingRun(overrides = {}) {
  return {
    id: RUN_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    thread_id: THREAD_ID,
    client_request_id: "initial-request",
    request_context_json: null,
    status: "waiting_user_input",
    risk_level: "low",
    prompt: "어느 회의록을 선택할까요?",
    timezone: "Asia/Seoul",
    message: "어느 회의록을 선택할까요?",
    final_answer: null,
    error_code: null,
    error_message: null,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    completed_at: null,
    created_at: new Date(Date.now() - 60_000),
    updated_at: new Date(Date.now() - 1000),
    messages: [
      {
        role: "assistant",
        content: "어느 회의록을 선택할까요?"
      }
    ],
    ...overrides
  };
}

function createState(run = waitingRun()) {
  return {
    runs: [run],
    confirmations: [],
    candidates: [],
    outbox: [{ run_id: run.id, status: "delivered", turn_sequence: 1 }],
    logs: [],
    messages: [...run.messages],
    createdRunCount: 0
  };
}

class FakeDatabase {
  constructor(state) {
    this.state = state;
  }

  async transaction(callback) {
    return callback(this);
  }

  async queryOne(text, values = []) {
    if (text.includes("log.event_type = 'message_routed'")) {
      const log = [...this.state.logs]
        .reverse()
        .find(
          (candidate) =>
            candidate.event_type === "message_routed" &&
            candidate.metadata.clientRequestId === values[2]
        );
      return log
        ? {
            run_id: log.run_id,
            request_fingerprint: log.metadata.requestFingerprint,
            outcome: log.metadata.outcome,
            relationship: log.metadata.relationship,
            previous_run_id: log.metadata.previousRunId,
            clarification_question: log.metadata.clarificationQuestion,
            active_run_was_null: String(log.metadata.activeRunWasNull),
            resolved_active_run_id: log.metadata.resolvedActiveRunId
          }
        : null;
    }
    if (
      text.includes("LEFT JOIN LATERAL") &&
      text.includes("ORDER BY run.updated_at DESC")
    ) {
      return this.latestWaitingSnapshot(values[0], values[1], values[2] ?? null);
    }
    if (text.includes("LEFT JOIN LATERAL")) {
      return this.snapshot(values[0], values[1], values[2]);
    }
    if (text.includes("SELECT confirmation.id")) {
      const confirmation = this.state.confirmations.find(
        (candidate) =>
          candidate.run_id === values[0] && candidate.status === "pending"
      );
      return confirmation ? { id: confirmation.id } : null;
    }
    if (text.includes("string_agg(candidate.id::text")) {
      const candidateIds = this.state.candidates
        .filter(
          (candidate) =>
            candidate.run_id === values[0] &&
            !candidate.consumed_at &&
            (!candidate.expires_at ||
              new Date(candidate.expires_at).getTime() > Date.now())
        )
        .map((candidate) => candidate.id)
        .sort();
      return { candidate_state: candidateIds.join(",") };
    }
    if (text.includes("SELECT id, expires_at") && text.includes("FROM agent_confirmations")) {
      const confirmation = this.state.confirmations.find(
        (candidate) =>
          candidate.id === values[0] &&
          candidate.run_id === values[1] &&
          candidate.status === "pending"
      );
      return confirmation
        ? { id: confirmation.id, expires_at: confirmation.expires_at }
        : null;
    }
    if (text.includes("$4::uuid AS pending_confirmation_id")) {
      return this.snapshot(values[0], values[1], values[2]);
    }
    if (text.includes("UPDATE agent_runs") && text.includes("status = 'cancelled'")) {
      const run = this.state.runs.find((candidate) => candidate.id === values[0]);
      if (!run || !["waiting_user_input", "waiting_confirmation"].includes(run.status)) {
        return null;
      }
      run.status = "cancelled";
      run.message = values[1];
      run.final_answer = null;
      run.error_code = null;
      run.error_message = null;
      run.completed_at = new Date();
      run.updated_at = new Date();
      return { id: run.id };
    }
    throw new Error(`Unhandled queryOne: ${text}`);
  }

  async query(text, values = []) {
    if (text.includes("FROM agent_run_messages")) {
      return this.state.messages.slice(-8);
    }
    if (text.includes("FROM agent_candidate_selections")) {
      return this.state.candidates
        .filter((candidate) => !candidate.consumed_at)
        .map((candidate) => ({ resource_type: candidate.resource_type }));
    }
    throw new Error(`Unhandled query: ${text}`);
  }

  async execute(text, values = []) {
    if (text.includes("pg_advisory_xact_lock")) return { rowCount: 1 };
    if (text.includes("UPDATE agent_confirmations")) {
      for (const confirmation of this.state.confirmations) {
        if (confirmation.run_id === values[0] && confirmation.status === "pending") {
          confirmation.status = "rejected";
          confirmation.rejected_by_user_id = values[1];
          confirmation.rejected_at = new Date();
        }
      }
      return { rowCount: 1 };
    }
    if (text.includes("UPDATE agent_candidate_selections")) {
      for (const candidate of this.state.candidates) {
        if (candidate.run_id === values[0] && !candidate.consumed_at) {
          candidate.consumed_at = new Date();
        }
      }
      return { rowCount: 1 };
    }
    if (text.includes("UPDATE agent_steps")) return { rowCount: 1 };
    if (text.includes("UPDATE agent_run_outbox")) {
      const outbox = this.state.outbox.find((candidate) => candidate.run_id === values[0]);
      if (outbox) outbox.status = "failed";
      return { rowCount: outbox ? 1 : 0 };
    }
    if (text.includes("INSERT INTO agent_run_messages")) {
      this.state.messages.push({ role: "assistant", content: values[1] });
      return { rowCount: 1 };
    }
    if (text.includes("'run_cancelled'")) {
      this.state.logs.push({
        run_id: values[1],
        event_type: "run_cancelled",
        metadata: {
          reason: values[3],
          replacementRunId: values[4]
        }
      });
      return { rowCount: 1 };
    }
    if (text.includes("'message_routed'")) {
      this.state.logs.push({
        run_id: values[1],
        event_type: "message_routed",
        metadata: {
          clientRequestId: values[3],
          requestFingerprint: values[4],
          outcome: values[5],
          relationship: values[6],
          confidence: values[7],
          activeRunWasNull: values[8],
          resolvedActiveRunId: values[9],
          previousRunId: values[10],
          clarificationQuestion: values[11]
        }
      });
      return { rowCount: 1 };
    }
    throw new Error(`Unhandled execute: ${text}`);
  }

  snapshot(runId, workspaceId, currentUserId) {
    const run = this.state.runs.find(
      (candidate) =>
        candidate.id === runId &&
        candidate.workspace_id === workspaceId &&
        candidate.requested_by_user_id === currentUserId
    );
    if (!run) return null;
    const confirmation = this.state.confirmations.find(
      (candidate) => candidate.run_id === runId && candidate.status === "pending"
    );
    return {
      ...run,
      pending_confirmation_id: confirmation?.id ?? null,
      confirmation_expires_at: confirmation?.expires_at ?? null
    };
  }

  latestWaitingSnapshot(workspaceId, currentUserId, conversationId = null) {
    const now = Date.now();
    const runs = this.state.runs
      .filter((run) => {
        if (
          run.workspace_id !== workspaceId ||
          run.requested_by_user_id !== currentUserId ||
          (conversationId !== null && run.thread_id !== conversationId) ||
          new Date(run.expires_at).getTime() <= now
        ) {
          return false;
        }
        if (run.status === "waiting_user_input") {
          return new Date(run.updated_at).getTime() > now - 24 * 60 * 60 * 1000;
        }
        if (run.status !== "waiting_confirmation") return false;
        return this.state.confirmations.some(
          (confirmation) =>
            confirmation.run_id === run.id &&
            confirmation.status === "pending" &&
            new Date(confirmation.expires_at).getTime() > now
        );
      })
      .sort((left, right) => {
        const updatedDifference =
          new Date(right.updated_at).getTime() -
          new Date(left.updated_at).getTime();
        if (updatedDifference) return updatedDifference;
        const createdDifference =
          new Date(right.created_at).getTime() -
          new Date(left.created_at).getTime();
        return createdDifference || right.id.localeCompare(left.id);
      });
    return runs[0]
      ? this.snapshot(runs[0].id, workspaceId, currentUserId)
      : null;
  }
}

class FakeAgentService {
  constructor(state) {
    this.state = state;
    this.resumeCount = 0;
  }

  normalizeCreateRunBody(body) {
    return {
      prompt: body.prompt.trim(),
      ...(Object.hasOwn(body, "conversationId")
        ? { conversationId: body.conversationId }
        : {}),
      timezone: body.timezone ?? "Asia/Seoul",
      clientRequestId: body.clientRequestId,
      requestContext: body.requestContext ?? null
    };
  }

  normalizeRunInputBody(body) {
    return body;
  }

  async assertRequestContextAccess() {}

  async isDeterministicCandidateContinuationInTransaction(
    _transaction,
    _currentUserId,
    _workspaceId,
    _runId,
    _requestContext,
    input
  ) {
    return Boolean(input.selection) || input.message === "두 번째";
  }

  async resumeRunInputInTransaction(
    _transaction,
    _currentUserId,
    _workspaceId,
    runId,
    input
  ) {
    const run = this.state.runs.find((candidate) => candidate.id === runId);
    run.status = "planning";
    run.message = "추가 정보를 반영하고 있습니다.";
    run.updated_at = new Date();
    this.state.messages.push({ role: "user", content: input.message });
    const outbox = this.state.outbox.find((candidate) => candidate.run_id === runId);
    outbox.status = "pending";
    outbox.turn_sequence += 1;
    this.resumeCount += 1;
    return "accepted";
  }

  async getRun(_currentUserId, _workspaceId, runId) {
    const run = this.state.runs.find((candidate) => candidate.id === runId);
    return {
      run: {
        id: run.id,
        conversationId: run.thread_id,
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

class FakeLoggingService {
  constructor(state) {
    this.state = state;
  }

  async createRunInTransaction(
    _transaction,
    currentUserId,
    workspaceId,
    input,
    forcedThreadId
  ) {
    const existing = this.state.runs.find(
      (candidate) => candidate.client_request_id === input.clientRequestId
    );
    if (existing) return { run: this.stored(existing), created: false };
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(
      this.state.createdRunCount + 1
    ).padStart(12, "0")}`;
    const run = waitingRun({
      id,
      workspace_id: workspaceId,
      requested_by_user_id: currentUserId,
      thread_id:
        forcedThreadId ??
        (input.conversationId === null
          ? "77777777-7777-4777-8777-777777777777"
          : input.conversationId ?? THREAD_ID),
      client_request_id: input.clientRequestId,
      request_context_json: input.requestContext,
      status: "planning",
      prompt: input.prompt,
      timezone: input.timezone,
      message: "요청을 분석하고 있습니다.",
      messages: [],
      created_at: new Date(),
      updated_at: new Date()
    });
    this.state.runs.push(run);
    this.state.outbox.push({ run_id: id, status: "pending", turn_sequence: 1 });
    this.state.createdRunCount += 1;
    return { run: this.stored(run), created: true };
  }

  stored(run) {
    return {
      id: run.id,
      conversationId: run.thread_id,
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
      completedAt: null,
      createdAt: new Date(run.created_at).toISOString(),
      updatedAt: new Date(run.updated_at).toISOString()
    };
  }
}

class FakeRelationshipService {
  constructor() {
    this.calls = [];
  }

  async classify(context) {
    this.calls.push(context);
    const relationship =
      context.newMessage === "그 작업 취소해줘"
        ? "cancel"
        : context.newMessage === "그거"
          ? "ambiguous"
          : context.newMessage === "다음 주 화요일"
            ? "continuation"
            : context.newMessage === "네"
              ? "continuation"
            : "new_intent";
    return {
      relationship,
      confidence: relationship === "ambiguous" ? "low" : "high",
      reason: "테스트 분류",
      clarificationQuestion:
        relationship === "ambiguous"
          ? "기존 작업을 이어갈까요, 아니면 새 요청을 시작할까요?"
          : null
    };
  }
}

function createService(state, suppliedRelationshipService = null) {
  const database = new FakeDatabase(state);
  const agentService = new FakeAgentService(state);
  const relationshipService =
    suppliedRelationshipService ?? new FakeRelationshipService();
  const publisher = { published: [], async publishCreatedRun(id) { this.published.push(id); } };
  return {
    service: new AgentMessageService(
      database,
      { async assertWorkspaceAccess() {} },
      agentService,
      new FakeLoggingService(state),
      relationshipService,
      publisher
    ),
    agentService,
    relationshipService,
    publisher
  };
}

function request(message, overrides = {}) {
  return {
    message,
    conversationId: THREAD_ID,
    timezone: "Asia/Seoul",
    clientRequestId: `request-${message}`,
    activeRunId: RUN_ID,
    requestContext: null,
    disposition: "auto",
    ...overrides
  };
}

{
  const state = createState(waitingRun({ status: "completed" }));
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("새 대화의 첫 요청", {
      activeRunId: null,
      clientRequestId: "explicit-new-conversation",
      conversationId: null
    })
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(
    result.run.conversationId,
    "77777777-7777-4777-8777-777777777777"
  );
}

{
  const state = createState();
  const { service } = createService(state);
  await assert.rejects(
    service.routeMessage(USER_ID, WORKSPACE_ID, {
      message: "이번 주 일정 보여줘",
      clientRequestId: "missing-active-run"
    }),
    (error) => error.getResponse().error.code === "BAD_REQUEST"
  );
}

{
  const state = createState();
  state.candidates.push({ run_id: RUN_ID, resource_type: "meeting_report" });
  const { service, agentService, relationshipService } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("후보 버튼", {
      selection: {
        kind: "candidate",
        candidateSelectionId: "66666666-6666-4666-8666-666666666666"
      }
    })
  );
  assert.equal(result.outcome, "continued");
  assert.equal(result.run.id, RUN_ID);
  assert.equal(agentService.resumeCount, 1);
  assert.equal(relationshipService.calls.length, 0);
}

{
  const state = createState();
  const { service, relationshipService } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("두 번째")
  );
  assert.equal(result.outcome, "continued");
  assert.equal(relationshipService.calls.length, 0);
}

{
  const state = createState(
    waitingRun({ prompt: "날짜를 알려주세요.", message: "날짜를 알려주세요." })
  );
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("다음 주 화요일")
  );
  assert.equal(result.outcome, "continued");
  assert.equal(state.runs[0].status, "planning");
}

{
  const budgetMessage =
    "한 요청에서 실행할 수 있는 작업은 최대 5회입니다. 다음 요청에서 계속 진행할 내용을 알려주세요.";
  const state = createState(
    waitingRun({
      prompt: "내일 일정 알려줘",
      message: budgetMessage,
      messages: [{ role: "assistant", content: budgetMessage }]
    })
  );
  const relationshipService = {
    calls: [],
    async classify(context) {
      this.calls.push(context);
      return {
        relationship: "continuation",
        confidence: "high",
        reason: "provider가 일반 입력을 잘못 continuation으로 분류",
        clarificationQuestion: null
      };
    }
  };
  const { service, publisher } = createService(state, relationshipService);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("하하하 일정의 날짜를 오늘로 바꿔줘", {
      clientRequestId: "budget-exhausted-calendar-update"
    })
  );

  assert.equal(result.outcome, "started_new");
  assert.equal(result.relationship, "new_intent");
  assert.equal(result.previousRun.status, "cancelled");
  assert.equal(result.run.prompt, "하하하 일정의 날짜를 오늘로 바꿔줘");
  assert.equal(result.run.conversationId, THREAD_ID);
  assert.deepEqual(publisher.published, [result.run.id]);
  assert.deepEqual(relationshipService.calls, []);
}

{
  const budgetMessage =
    "한 요청에서 계획할 수 있는 작업은 최대 5회입니다. 다음 요청에서 계속 진행할 내용을 알려주세요.";
  const state = createState(
    waitingRun({
      prompt: "긴 작업을 처리해줘",
      message: budgetMessage,
      messages: [{ role: "assistant", content: budgetMessage }]
    })
  );
  const { service, agentService, relationshipService } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("남은 작업을 이어서 처리해줘", {
      clientRequestId: "budget-exhausted-explicit-continuation"
    })
  );

  assert.equal(result.outcome, "continued");
  assert.equal(result.relationship, "continuation");
  assert.equal(result.run.id, RUN_ID);
  assert.equal(agentService.resumeCount, 1);
  assert.deepEqual(relationshipService.calls, []);
}

{
  const budgetMessage =
    "한 요청에서 실행할 수 있는 작업은 최대 5회입니다. 다음 요청에서 계속 진행할 내용을 알려주세요.";
  const state = createState(
    waitingRun({
      prompt: "내일 일정 알려줘",
      message: budgetMessage,
      messages: [{ role: "assistant", content: budgetMessage }]
    })
  );
  const relationshipService = {
    calls: [],
    async classify(context) {
      this.calls.push(context);
      return {
        relationship: "ambiguous",
        confidence: "low",
        reason: "참조 대상이 모호합니다.",
        clarificationQuestion:
          "기존 작업을 이어갈까요, 아니면 새 요청을 시작할까요?"
      };
    }
  };
  const { service } = createService(state, relationshipService);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("그거", {
      clientRequestId: "budget-exhausted-ambiguous-reference"
    })
  );

  assert.equal(result.outcome, "needs_choice");
  assert.equal(result.relationship, "ambiguous");
  assert.equal(state.runs[0].status, "waiting_user_input");
  assert.equal(relationshipService.calls.length, 1);
  assert.equal(
    relationshipService.calls[0].waitingInputKind,
    "budget_exhausted"
  );
}

{
  const state = createState(
    waitingRun({
      prompt: `회의록 ${THREAD_ID} token=internal-provider-token을 선택해 주세요.`,
      message: "회의록을 선택해 주세요."
    })
  );
  const { service, relationshipService } = createService(state);
  await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request(`새 요청 ${RUN_ID} authorization=Bearer-private-token`)
  );
  const providerContext = JSON.stringify(relationshipService.calls[0]);
  assert.doesNotMatch(providerContext, new RegExp(THREAD_ID, "i"));
  assert.doesNotMatch(providerContext, new RegExp(RUN_ID, "i"));
  assert.doesNotMatch(providerContext, /internal-provider-token/);
  assert.doesNotMatch(providerContext, /Bearer-private-token/);
  assert.match(providerContext, /\[resource\]/);
  assert.match(providerContext, /\[secret\]/);
}

{
  const longPem = [
    "-----BEGIN PRIVATE KEY-----",
    "A".repeat(1600),
    "-----END PRIVATE KEY-----"
  ].join("\n");
  const state = createState(
    waitingRun({
      prompt: `기존 목표 ${longPem}`,
      messages: [
        { role: "assistant", content: `대기 질문 ${longPem}` }
      ]
    })
  );
  const { service, relationshipService } = createService(state);
  await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request(`새 요청 ${longPem}`, { clientRequestId: "long-pem-redaction" })
  );
  const providerContext = JSON.stringify(relationshipService.calls[0]);
  assert.doesNotMatch(providerContext, /BEGIN PRIVATE KEY/);
  assert.doesNotMatch(providerContext, /END PRIVATE KEY/);
  assert.doesNotMatch(providerContext, /A{100}/);
  assert.ok((providerContext.match(/\[secret\]/g)?.length ?? 0) >= 3);
}

{
  const state = createState();
  const { service, publisher } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("이번 주 일정 보여줘")
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(result.previousRun.status, "cancelled");
  assert.equal(result.previousRun.errorMessage, null);
  assert.equal(result.run.status, "planning");
  assert.equal(state.runs[1].thread_id, THREAD_ID);
  assert.deepEqual(publisher.published, [state.runs[1].id]);
  const cancellationLog = state.logs.find(
    (log) => log.event_type === "run_cancelled"
  );
  assert.equal(cancellationLog.metadata.reason, "superseded_by_new_intent");
  assert.equal(cancellationLog.metadata.replacementRunId, state.runs[1].id);
  assert.equal(
    state.logs.find((log) => log.event_type === "message_routed").metadata
      .confidence,
    "high"
  );
}

{
  const olderRun = waitingRun({
    id: "33333333-3333-4333-8333-333333333331",
    updated_at: new Date(Date.now() - 10_000),
    created_at: new Date(Date.now() - 20_000)
  });
  const state = createState(olderRun);
  const newestRun = waitingRun({
    id: "33333333-3333-4333-8333-333333333332",
    updated_at: new Date(Date.now() - 1000),
    created_at: new Date(Date.now() - 2000)
  });
  state.runs.push(newestRun);
  state.outbox.push({ run_id: newestRun.id, status: "delivered", turn_sequence: 1 });
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("이번 주 일정 보여줘", {
      activeRunId: null,
      clientRequestId: "recover-latest-waiting-run"
    })
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(result.previousRun.id, newestRun.id);
  assert.equal(state.runs[0].status, "waiting_user_input");
  assert.equal(state.runs[1].status, "cancelled");
  assert.equal(result.run.id, state.runs[2].id);
}

{
  const state = createState(waitingRun({ status: "completed" }));
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("일반 신규 요청", {
      activeRunId: null,
      clientRequestId: "no-eligible-waiting-run"
    })
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(result.previousRun, null);
  assert.equal(state.createdRunCount, 1);
}

{
  const state = createState(
    waitingRun({ status: "waiting_confirmation", prompt: "일정을 생성할까요?" })
  );
  state.confirmations.push({
    id: CONFIRMATION_ID,
    run_id: RUN_ID,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000)
  });
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("이번 주 일정 보여줘", {
      activeRunId: null,
      clientRequestId: "recover-waiting-confirmation"
    })
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(result.previousRun.id, RUN_ID);
  assert.equal(state.confirmations[0].status, "pending");
  assert.equal(state.runs[0].status, "waiting_confirmation");
}

for (const fixture of [
  {
    relationship: "continuation",
    confidence: "medium",
    expectedOutcome: "continued"
  },
  {
    relationship: "continuation",
    confidence: "low",
    expectedOutcome: "needs_choice"
  },
  {
    relationship: "new_intent",
    confidence: "medium",
    expectedOutcome: "started_new"
  },
  {
    relationship: "new_intent",
    confidence: "low",
    expectedOutcome: "started_new"
  },
  {
    relationship: "cancel",
    confidence: "medium",
    expectedOutcome: "needs_choice"
  },
  {
    relationship: "cancel",
    confidence: "low",
    expectedOutcome: "needs_choice"
  }
]) {
  const state = createState();
  const relationshipService = {
    async classify() {
      return {
        relationship: fixture.relationship,
        confidence: fixture.confidence,
        reason: "confidence 정책 테스트",
        clarificationQuestion: null
      };
    }
  };
  const { service } = createService(state, relationshipService);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request(`confidence-${fixture.relationship}-${fixture.confidence}`)
  );
  assert.equal(result.outcome, fixture.expectedOutcome);
  if (fixture.expectedOutcome === "needs_choice") {
    assert.equal(state.runs[0].status, "waiting_user_input");
    assert.equal(state.createdRunCount, 0);
  }
}

{
  const state = createState();
  const relationshipService = {
    async classify() {
      state.runs[0].status = "completed";
      state.runs[0].updated_at = new Date();
      return {
        relationship: "new_intent",
        confidence: "high",
        reason: "분류 중 상태 변경",
        clarificationQuestion: null
      };
    }
  };
  const { service } = createService(state, relationshipService);
  await assert.rejects(
    service.routeMessage(
      USER_ID,
      WORKSPACE_ID,
      request("분류 중 상태가 바뀌는 요청", {
        clientRequestId: "stale-classification"
      })
    ),
    (error) =>
      error.getResponse().error.code === "AGENT_MESSAGE_ROUTING_STALE"
  );
  assert.equal(state.createdRunCount, 0);
}

{
  const state = createState();
  state.candidates.push({
    id: "66666666-6666-4666-8666-666666666667",
    run_id: RUN_ID,
    resource_type: "meeting_report",
    expires_at: new Date(Date.now() + 60_000),
    consumed_at: null
  });
  const relationshipService = {
    async classify() {
      state.candidates[0].consumed_at = new Date();
      return {
        relationship: "new_intent",
        confidence: "high",
        reason: "분류 중 후보 소비",
        clarificationQuestion: null
      };
    }
  };
  const { service } = createService(state, relationshipService);
  await assert.rejects(
    service.routeMessage(
      USER_ID,
      WORKSPACE_ID,
      request("후보가 먼저 소비되는 경합", {
        clientRequestId: "stale-candidate"
      })
    ),
    (error) =>
      error.getResponse().error.code === "AGENT_MESSAGE_ROUTING_STALE"
  );
  assert.equal(state.runs[0].status, "waiting_user_input");
  assert.equal(state.createdRunCount, 0);
}

{
  const state = createState();
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("그건 됐고 이번 주 일정 보여줘")
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(state.runs[0].status, "cancelled");
  assert.equal(state.runs[1].thread_id, THREAD_ID);
  assert.equal(
    state.logs.find((log) => log.event_type === "run_cancelled").metadata.reason,
    "superseded_by_new_intent"
  );
}

{
  const state = createState();
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("그 작업 취소해줘")
  );
  assert.equal(result.outcome, "cancelled");
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].error_code, null);
  assert.equal(
    state.logs.find((log) => log.event_type === "run_cancelled").metadata.reason,
    "cancelled_by_user"
  );
}

{
  const state = createState();
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("그거")
  );
  assert.equal(result.outcome, "needs_choice");
  assert.equal(state.runs[0].status, "waiting_user_input");
  assert.equal(state.createdRunCount, 0);
  const continued = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("그거", { disposition: "continue_previous" })
  );
  assert.equal(continued.outcome, "continued");
}

{
  const state = createState();
  const { service } = createService(state);
  const input = request("그거", {
    activeRunId: null,
    clientRequestId: "recovered-ambiguous-choice"
  });
  const ambiguous = await service.routeMessage(USER_ID, WORKSPACE_ID, input);
  assert.equal(ambiguous.outcome, "needs_choice");
  const continued = await service.routeMessage(USER_ID, WORKSPACE_ID, {
    ...input,
    activeRunId: ambiguous.run.id,
    disposition: "continue_previous"
  });
  assert.equal(continued.outcome, "continued");
  assert.equal(continued.run.id, RUN_ID);
}

{
  const state = createState();
  const { service } = createService(state);
  const input = request("그거", { clientRequestId: "ambiguous-start-new" });
  await service.routeMessage(USER_ID, WORKSPACE_ID, input);
  const result = await service.routeMessage(USER_ID, WORKSPACE_ID, {
    ...input,
    disposition: "start_new"
  });
  assert.equal(result.outcome, "started_new");
  assert.equal(state.createdRunCount, 1);
}

{
  const state = createState(
    waitingRun({ status: "waiting_confirmation", prompt: "일정을 생성할까요?" })
  );
  state.confirmations.push({
    id: CONFIRMATION_ID,
    run_id: RUN_ID,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000)
  });
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("이번 주 일정 보여줘")
  );
  assert.equal(result.outcome, "started_new");
  assert.equal(state.confirmations[0].status, "pending");
  assert.equal(state.runs[0].status, "waiting_confirmation");
  assert.equal(state.runs[1].thread_id, THREAD_ID);
}

{
  const state = createState(
    waitingRun({ status: "waiting_confirmation", prompt: "일정을 생성할까요?" })
  );
  state.confirmations.push({
    id: CONFIRMATION_ID,
    run_id: RUN_ID,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000)
  });
  const { service } = createService(state);
  const result = await service.routeMessage(
    USER_ID,
    WORKSPACE_ID,
    request("네")
  );
  assert.equal(result.outcome, "needs_choice");
  assert.equal(state.confirmations[0].status, "pending");
  assert.equal(state.runs[0].status, "waiting_confirmation");
}

{
  const state = createState();
  const { service } = createService(state);
  const input = request("이번 주 일정 보여줘", {
    clientRequestId: "duplicate-request"
  });
  const first = await service.routeMessage(USER_ID, WORKSPACE_ID, input);
  const second = await service.routeMessage(USER_ID, WORKSPACE_ID, input);
  assert.equal(first.run.id, second.run.id);
  assert.equal(state.createdRunCount, 1);
}

{
  process.env.AGENT_MESSAGE_ROUTING_MODE = "legacy";
  const state = createState();
  const { service } = createService(state);
  await assert.rejects(
    service.routeMessage(USER_ID, WORKSPACE_ID, request("이번 주 일정 보여줘")),
    (error) =>
      error.getResponse().error.code === "AGENT_MESSAGE_ROUTING_DISABLED"
  );
  assert.equal(state.runs.length, 1);
  process.env.AGENT_MESSAGE_ROUTING_MODE = "intent";
}

{
  const state = createState();
  const relationshipService = {
    async classify() {
      throw new AgentInputRelationshipUnavailableError();
    }
  };
  const { service } = createService(state, relationshipService);
  await assert.rejects(
    service.routeMessage(USER_ID, WORKSPACE_ID, request("이번 주 일정 보여줘")),
    (error) =>
      error.getResponse().error.code === "AGENT_MESSAGE_ROUTING_UNAVAILABLE"
  );
  assert.equal(state.runs[0].status, "waiting_user_input");
  assert.equal(state.createdRunCount, 0);
}

console.log("agent message lifecycle tests passed");
