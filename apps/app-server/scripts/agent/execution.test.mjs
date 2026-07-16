import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentExecutionService } = require(
  "../../dist/modules/agent/agent-execution.service.js"
);
const { buildAgentReadResultAnswer } = require(
  "../../dist/modules/agent/agent-read-result-formatter.js"
);
const { AgentExecutionHandoffGuard } = require(
  "../../dist/modules/agent/agent-execution-handoff.guard.js"
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
const { BoardContextResolverService } = require(
  "../../dist/modules/agent/tools/board-context-resolver.service.js"
);
const { badRequest } = require("../../dist/common/api-error.js");

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const STEP_ID = "44444444-4444-4444-4444-444444444444";
const CONFIRMATION_ID = "55555555-5555-5555-5555-555555555555";
const REPORT_ID = "66666666-6666-4666-8666-666666666666";

function plannerOutput(overrides = {}) {
  return {
    status: "tool_candidate",
    message: "Calendar 일정 조회 후보입니다.",
    finalAnswerDraft: "일정 조회 계획을 만들었습니다.",
    toolName: "list_calendar_events",
    riskLevel: "low",
    executionMode: "auto",
    requiresConfirmation: false,
    input: {
      start: "2026-07-09",
      end: "2026-07-16",
      providerRawResponse: "must-not-leak"
    },
    toolInputValidation: "app_server_required",
    ...overrides
  };
}

function confirmationPlan() {
  return {
    toolName: "create_calendar_event",
    summary: "주간 회의 일정을 생성합니다.",
    target: {
      domain: "calendar",
      resourceType: "event"
    },
    before: null,
    after: {
      title: "주간 회의",
      startDate: "2026-07-10",
      endDate: "2026-07-10"
    },
    call: {
      service: "CalendarService.createEvent",
      method: "POST",
      path: "/api/v1/workspaces/{workspaceId}/calendar/events"
    }
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
    this.calls = [];
  }

  async queryOne(text, values = []) {
    this.calls.push({ text, values });

    if (text.includes(" AS started")) {
      return {
        started: this.state.executionStarted ?? false
      };
    }

    if (text.includes("SELECT id, workspace_id, requested_by_user_id, status")) {
      const [runId] = values;
      const run = this.state.run;
      return run && run.id === runId ? run : null;
    }

    if (text.includes("FROM agent_runs")) {
      const [runId, workspaceId, currentUserId] = values;
      const run = this.state.run;
      return run &&
        run.id === runId &&
        run.workspace_id === workspaceId &&
        run.requested_by_user_id === currentUserId
        ? { id: run.id, status: run.status }
        : null;
    }

    if (text.includes("FROM agent_steps")) {
      return this.state.plannerStep ?? null;
    }

    throw new Error(`Unhandled queryOne: ${text}`);
  }
}

class FakeAgentLoggingService {
  constructor(state) {
    this.state = state;
    this.calls = [];
  }

  async startNextToolStepIfAbsent(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "startNextToolStepIfAbsent",
      currentUserId,
      workspaceId,
      input
    });

    return {
      id: STEP_ID,
      runId: input.runId,
      status: "running"
    };
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

  async completeRun(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "completeRun",
      currentUserId,
      workspaceId,
      input
    });

    return {
      id: input.runId,
      workspaceId,
      requestedByUserId: currentUserId,
      clientRequestId: null,
      status: "completed",
      riskLevel: input.riskLevel,
      prompt: "이번 주 일정 알려줘",
      timezone: "Asia/Seoul",
      message: input.message,
      finalAnswer: input.finalAnswer,
      errorCode: null,
      errorMessage: null,
      expiresAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z"
    };
  }

  async failRun(currentUserId, workspaceId, input) {
    this.calls.push({
      method: "failRun",
      currentUserId,
      workspaceId,
      input
    });

    return {
      id: input.runId,
      workspaceId,
      requestedByUserId: currentUserId,
      clientRequestId: null,
      status: "failed",
      riskLevel: null,
      prompt: "이번 주 일정 알려줘",
      timezone: "Asia/Seoul",
      message: input.message,
      finalAnswer: null,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      expiresAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-07-10T00:00:00.000Z",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z"
    };
  }
}

class FakeAgentConfirmationService {
  constructor() {
    this.calls = [];
  }

  async createConfirmation(currentUserId, workspaceId, input) {
    this.calls.push({
      currentUserId,
      workspaceId,
      input
    });

    return {
      id: CONFIRMATION_ID,
      runId: input.runId,
      status: "pending",
      riskLevel: input.riskLevel,
      plan: input.plan,
      expiresAt: "2026-07-10T00:15:00.000Z",
      approvedAt: null,
      rejectedAt: null,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z"
    };
  }
}

class FakeAgentToolRegistryService {
  constructor(state) {
    this.state = state;
    this.calls = [];
  }

  getDefinition(name) {
    this.calls.push({ method: "getDefinition", name });

    if (this.state.missingTool) {
      return null;
    }

    const riskLevel = this.state.riskLevel ?? "low";
    const executionMode = this.state.executionMode ?? "auto";
    return {
      name: this.state.name ?? name,
      description: "fake tool",
      riskLevel,
      executionMode,
      inputSchema: {},
      validateInput: (input) => {
        this.calls.push({ method: "validateInput", input });

        if (this.state.validationError) {
          throw this.state.validationError;
        }

        return {
          ...input,
          validated: true
        };
      },
      buildConfirmation: this.state.withoutConfirmationBuilder
        ? undefined
        : async (input) => {
            this.calls.push({ method: "buildConfirmation", input });
            return confirmationPlan();
          },
      execute: async (context, input) => {
        this.calls.push({ method: "execute", context, input });

        if (this.state.executionError) {
          throw this.state.executionError;
        }

        return {
          outputSummary: {
            count: 1,
            transcriptText: "must-not-leak",
            nested: {
              visible: "ok",
              token: "must-not-leak"
            }
          },
          resourceRefs: [
            {
              domain: "calendar",
              resourceType: "event",
              resourceId: "1",
              label: "주간 회의",
              metadata: {
                visible: "ok",
                token: "must-not-leak"
              }
            }
          ],
          status: "completed"
        };
      }
    };
  }
}

function createSmokeEvent(overrides = {}) {
  return {
    id: 1,
    title: "주간 회의",
    description: null,
    color: "#3B82F6",
    isAllDay: false,
    startDate: "2026-07-10",
    endDate: "2026-07-10",
    startTime: "15:00",
    endTime: "16:00",
    createdBy: USER_ID,
    createdByUser: {
      id: USER_ID,
      name: "Jin",
      avatarUrl: null
    },
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides
  };
}

function createSmokeReport(overrides = {}) {
  return {
    id: REPORT_ID,
    meetingId: "77777777-7777-7777-8777-777777777777",
    recordingId: "88888888-8888-8888-8888-888888888888",
    status: "COMPLETED",
    failedStep: null,
    errorMessage: null,
    transcriptText: "Agent smoke test must not persist transcript text.",
    summary: "회의 요약",
    discussionPoints: "논의사항",
    decisions: "결정사항",
    actionItemCandidates: [],
    retryCount: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides
  };
}

class SmokeCalendarService {
  constructor() {
    this.calls = [];
    this.events = [createSmokeEvent()];
  }

  async listEvents(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listEvents",
      currentUserId,
      workspaceId,
      query
    });
    return this.events;
  }

  async getEvent(currentUserId, workspaceId, eventId) {
    this.calls.push({
      method: "getEvent",
      currentUserId,
      workspaceId,
      eventId
    });
    return this.events.find((event) => event.id === Number(eventId));
  }

  async createEvent(currentUserId, workspaceId, body) {
    this.calls.push({
      method: "createEvent",
      currentUserId,
      workspaceId,
      body
    });
    return createSmokeEvent(body);
  }

  async updateEvent(currentUserId, workspaceId, eventId, body) {
    this.calls.push({
      method: "updateEvent",
      currentUserId,
      workspaceId,
      eventId,
      body
    });
    return createSmokeEvent({ id: Number(eventId), ...body });
  }
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "update_calendar_event",
    outputSummary: {
      status: "needs_clarification",
      selection: "multiple",
      candidateCount: 2
    },
    resourceRefs: [
      {
        domain: "calendar",
        resourceType: "event",
        resourceId: "1",
        label: "주간 회의"
      }
    ]
  });

  assert.match(answer, /여러 개/);
  assert.doesNotMatch(answer, /주간 회의|resourceId|1/);
}

class SmokeMeetingService {
  constructor() {
    this.calls = [];
    this.report = createSmokeReport();
  }

  async listReports(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listReports",
      currentUserId,
      workspaceId,
      query
    });
    const { transcriptText, ...summary } = this.report;
    return {
      reports: [summary]
    };
  }

  async getReport(currentUserId, workspaceId, reportId) {
    this.calls.push({
      method: "getReport",
      currentUserId,
      workspaceId,
      reportId
    });
    return {
      report: this.report
    };
  }
}

class SmokeBoardService {
  constructor() {
    this.calls = [];
    this.boards = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        name: "제품 개발",
        repository: {
          id: "repository-id",
          fullName: "Developer-EJ/PILO",
          htmlUrl: "https://github.com/Developer-EJ/PILO"
        },
        project: {
          id: "project-id",
          title: "제품 개발",
          projectNumber: 1,
          githubProjectNodeId: "PVT_test",
          url: "https://github.com/orgs/Developer-EJ/projects/1"
        }
      }
    ];
    this.issues = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        issueNumber: "#729",
        title: "Board read/search tool adapter",
        state: "open",
        labels: [{ name: "agent" }],
        assignees: [{ login: "jinhokingofworld" }],
        htmlUrl: "https://github.com/Developer-EJ/PILO/issues/729"
      }
    ];
  }

  async getActiveBoardSource(currentUserId, workspaceId) {
    this.calls.push({
      method: "getActiveBoardSource",
      currentUserId,
      workspaceId
    });
    return null;
  }

  async listBoards(currentUserId, workspaceId, query) {
    this.calls.push({ method: "listBoards", currentUserId, workspaceId, query });
    return {
      data: this.boards,
      meta: { page: 1, limit: 100, total: this.boards.length }
    };
  }

  async listBoardIssues(currentUserId, workspaceId, boardId, query) {
    this.calls.push({
      method: "listBoardIssues",
      currentUserId,
      workspaceId,
      boardId,
      query
    });
    return {
      data: this.issues,
      meta: { page: 1, limit: query.limit, total: this.issues.length }
    };
  }
}

function createSmokeRegistry() {
  const calendarService = new SmokeCalendarService();
  const meetingService = new SmokeMeetingService();
  const boardService = new SmokeBoardService();
  const boardContextResolver = new BoardContextResolverService(boardService);
  const registry = new AgentToolRegistryService(
    new CalendarAgentToolsService(calendarService),
    new MeetingAgentToolsService(meetingService),
    new BoardAgentToolsService(boardService, boardContextResolver)
  );

  return {
    calendarService,
    meetingService,
    boardService,
    registry
  };
}

function createExecutionServiceWithRegistry(
  planner,
  registry,
  {
    prompt = "이번 주 일정 알려줘",
    timezone = "Asia/Seoul"
  } = {}
) {
  const state = {
    run: {
      id: RUN_ID,
      workspace_id: WORKSPACE_ID,
      requested_by_user_id: USER_ID,
      status: "running",
      prompt,
      timezone
    },
    plannerStep: {
      id: STEP_ID,
      output_json: planner
    }
  };
  const workspaceService = new FakeWorkspaceService();
  const database = new FakeDatabaseService(state);
  const loggingService = new FakeAgentLoggingService(state);
  const confirmationService = new FakeAgentConfirmationService();

  return {
    service: new AgentExecutionService(
      database,
      workspaceService,
      loggingService,
      confirmationService,
      registry
    ),
    confirmationService,
    loggingService,
    workspaceService
  };
}

function createService({
  registryState = {},
  runStatus = "running",
  planner = plannerOutput(),
  executionStarted = false
} = {}) {
  const state = {
    run: {
      id: RUN_ID,
      workspace_id: WORKSPACE_ID,
      requested_by_user_id: USER_ID,
      status: runStatus,
      prompt: "이번 주 일정 알려줘",
      timezone: "Asia/Seoul"
    },
    plannerStep: {
      id: STEP_ID,
      output_json: planner
    },
    executionStarted
  };
  const workspaceService = new FakeWorkspaceService();
  const database = new FakeDatabaseService(state);
  const loggingService = new FakeAgentLoggingService(state);
  const confirmationService = new FakeAgentConfirmationService();
  const toolRegistryService = new FakeAgentToolRegistryService(registryState);

  return {
    service: new AgentExecutionService(
      database,
      workspaceService,
      loggingService,
      confirmationService,
      toolRegistryService
    ),
    workspaceService,
    database,
    loggingService,
    confirmationService,
    toolRegistryService
  };
}

function createHandoffGuardContext(token) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return {
            headers: {
              "x-agent-execution-handoff-token": token
            }
          };
        }
      };
    }
  };
}

function formatterMeetingReport(index, overrides = {}) {
  return {
    reportId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    meetingId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    status: "COMPLETED",
    createdAt: `2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    sections: [
      { key: "summary", title: "요약", text: `회의 요약 ${index}` },
      {
        key: "discussionPoints",
        title: "논의사항",
        text: `논의사항 ${index}`
      },
      { key: "decisions", title: "결정사항", text: `결정사항 ${index}` }
    ],
    actionItems: [{ title: `후속 작업 ${index}` }],
    transcript: {
      available: true,
      stored: false,
      token: "must-not-leak"
    },
    ...overrides
  };
}

{
  const events = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    title: `일정 ${index + 1}`,
    isAllDay: false,
    startDate: "2026-07-10",
    endDate: "2026-07-10",
    startTime: `${String(9 + index).padStart(2, "0")}:00`,
    endTime: `${String(10 + index).padStart(2, "0")}:00`,
    status: "available"
  }));
  const answer = buildAgentReadResultAnswer({
    toolName: "list_calendar_events",
    outputSummary: {
      start: "2026-07-10",
      end: "2026-07-10",
      count: events.length,
      events
    },
    resourceRefs: []
  });

  assert.match(answer, /2026-07-10 일정 6개/);
  assert.match(answer, /09:00-10:00 · 일정 1/);
  assert.match(answer, /외 1개/);
  assert.doesNotMatch(answer, /일정 6$/m);
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "list_calendar_events",
    outputSummary: {
      start: "2026-07-10",
      end: "2026-07-10",
      count: 0,
      events: []
    },
    resourceRefs: []
  });

  assert.equal(answer, "2026-07-10 일정이 없습니다.");
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "summarize_meeting_report",
    prompt: "이 회의록 보여줘",
    timezone: "Asia/Seoul",
    outputSummary: {
      report: formatterMeetingReport(8)
    },
    resourceRefs: []
  });

  assert.match(answer, /2026-07-08 09:00 · 완료/);
  assert.match(answer, /요약: 회의 요약 8/);
  assert.match(answer, /논의사항: 논의사항 8/);
  assert.match(answer, /결정사항: 결정사항 8/);
  assert.match(answer, /후속 작업:\n- 후속 작업 8/);
  assert.doesNotMatch(answer, /00000000-0000/);
  assert.doesNotMatch(answer, /must-not-leak/);
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "summarize_meeting_report",
    prompt: "결정사항만 알려줘",
    timezone: "Asia/Seoul",
    outputSummary: {
      report: formatterMeetingReport(8)
    },
    resourceRefs: []
  });

  assert.match(answer, /결정사항: 결정사항 8/);
  assert.doesNotMatch(answer, /요약:/);
  assert.doesNotMatch(answer, /논의사항:/);
  assert.doesNotMatch(answer, /후속 작업:/);
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "summarize_meeting_report",
    prompt: "요약 말고 결정사항만 알려줘",
    outputSummary: {
      report: formatterMeetingReport(8)
    },
    resourceRefs: []
  });

  assert.match(answer, /결정사항: 결정사항 8/);
  assert.doesNotMatch(answer, /요약:/);
  assert.doesNotMatch(answer, /논의사항:/);
  assert.doesNotMatch(answer, /후속 작업:/);
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "summarize_meeting_report",
    prompt: "요약과 논의사항은 빼고 결정사항과 후속 작업만 알려줘",
    outputSummary: {
      report: formatterMeetingReport(8)
    },
    resourceRefs: []
  });

  assert.match(answer, /결정사항: 결정사항 8/);
  assert.match(answer, /후속 작업:\n- 후속 작업 8/);
  assert.doesNotMatch(answer, /요약:/);
  assert.doesNotMatch(answer, /논의사항:/);
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "summarize_meeting_report",
    prompt: "요약은 빼고 보여줘",
    outputSummary: {
      report: formatterMeetingReport(8)
    },
    resourceRefs: []
  });

  assert.doesNotMatch(answer, /요약:/);
  assert.match(answer, /논의사항: 논의사항 8/);
  assert.match(answer, /결정사항: 결정사항 8/);
  assert.match(answer, /후속 작업:\n- 후속 작업 8/);
}

{
  const reports = Array.from({ length: 6 }, (_, index) =>
    formatterMeetingReport(index + 1)
  );
  const answer = buildAgentReadResultAnswer({
    toolName: "list_meeting_reports",
    prompt: "최근 회의록 보여줘",
    timezone: "Asia/Seoul",
    outputSummary: {
      count: reports.length,
      reports
    },
    resourceRefs: []
  });

  assert.match(answer, /회의록 6개/);
  assert.match(answer, /요약: 회의 요약 1/);
  assert.match(answer, /외 1개/);
  assert.doesNotMatch(answer, /회의 요약 6/);
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "list_meeting_reports",
    outputSummary: {
      count: 0,
      reports: []
    },
    resourceRefs: []
  });

  assert.equal(answer, "조회된 회의록이 없습니다.");
}

{
  const answer = buildAgentReadResultAnswer({
    toolName: "get_meeting_report",
    outputSummary: {
      report: formatterMeetingReport(8, {
        status: "PROCESSING",
        sections: [],
        actionItems: []
      })
    },
    resourceRefs: []
  });

  assert.match(answer, /생성 중/);
  assert.match(answer, /회의록을 생성하고 있습니다/);
}

{
  const longSummary = "긴 요약 ".repeat(200);
  const answer = buildAgentReadResultAnswer({
    toolName: "summarize_meeting_report",
    prompt: "요약만 알려줘",
    outputSummary: {
      report: formatterMeetingReport(8, {
        sections: [{ key: "summary", title: "요약", text: longSummary }]
      })
    },
    resourceRefs: []
  });

  assert.equal(answer.length < longSummary.length, true);
  assert.match(answer, /…$/);
}

{
  const previousToken = process.env.AGENT_EXECUTION_HANDOFF_TOKEN;
  process.env.AGENT_EXECUTION_HANDOFF_TOKEN = "handoff-test-token";
  const guard = new AgentExecutionHandoffGuard();

  assert.equal(
    await guard.canActivate(createHandoffGuardContext("handoff-test-token")),
    true
  );
  await assert.rejects(
    () => guard.canActivate(createHandoffGuardContext("incorrect-token")),
    (error) => error.getStatus() === 401
  );

  if (previousToken === undefined) {
    delete process.env.AGENT_EXECUTION_HANDOFF_TOKEN;
  } else {
    process.env.AGENT_EXECUTION_HANDOFF_TOKEN = previousToken;
  }
}

{
  const { service, loggingService, workspaceService } = createService();
  const result = await service.executeReadyRun(RUN_ID);

  assert.equal(result.status, "completed");
  assert.deepEqual(workspaceService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID }
  ]);
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["startNextToolStepIfAbsent", "completeStep", "completeRun"]
  );
}

{
  const { service, loggingService } = createService({
    runStatus: "completed"
  });
  const result = await service.executeReadyRun(RUN_ID);

  assert.deepEqual(result, {
    status: "skipped",
    reason: "not_ready"
  });
  assert.deepEqual(loggingService.calls, []);
}

{
  const { service, workspaceService, database, loggingService, toolRegistryService } =
    createService();

  const result = await service.executeReadyRun(RUN_ID);

  assert.equal(result.status, "completed");
  assert.equal(result.run.status, "completed");
  assert.deepEqual(workspaceService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID }
  ]);
  assert.equal(database.calls.length, 4);
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition", "validateInput", "execute"]
  );
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["startNextToolStepIfAbsent", "completeStep", "completeRun"]
  );
  assert.equal(
    "providerRawResponse" in loggingService.calls[0].input.inputSummary.input,
    false
  );
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
  assert.match(loggingService.calls[2].input.finalAnswer, /관련 리소스 1개/);
}

{
  const { service, loggingService, toolRegistryService } = createService({
    executionStarted: true
  });

  const result = await service.executeReadyRun(RUN_ID);

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "already_started");
  assert.deepEqual(loggingService.calls, []);
  assert.deepEqual(toolRegistryService.calls, []);
}

{
  const planner = plannerOutput({
    toolName: "create_calendar_event",
    riskLevel: "medium",
    executionMode: "confirmation_required",
    requiresConfirmation: true,
    input: {
      title: "주간 회의",
      startDate: "2026-07-10",
      endDate: "2026-07-10"
    }
  });
  const {
    service,
    loggingService,
    confirmationService,
    toolRegistryService
  } = createService({
    planner,
    registryState: {
      riskLevel: "medium",
      executionMode: "confirmation_required"
    }
  });

  const result = await service.executePlannerOutput(USER_ID, WORKSPACE_ID, RUN_ID, {
    plannerOutput: planner
  });

  assert.equal(result.status, "waiting_confirmation");
  assert.equal(result.confirmation.status, "pending");
  assert.deepEqual(loggingService.calls, []);
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition", "validateInput", "buildConfirmation"]
  );
  assert.equal(confirmationService.calls[0].input.toolName, "create_calendar_event");
  assert.equal(confirmationService.calls[0].input.riskLevel, "medium");
}

{
  const { service, loggingService, toolRegistryService } = createService({
    registryState: {
      missingTool: true
    }
  });

  const result = await service.executePlannerOutput(USER_ID, WORKSPACE_ID, RUN_ID, {
    plannerOutput: plannerOutput()
  });

  assert.equal(result.status, "failed");
  assert.equal(result.run.errorCode, "AGENT_TOOL_NOT_EXECUTABLE");
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["failRun"]
  );
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition"]
  );
}

{
  const { service, loggingService } = createService({
    registryState: {
      riskLevel: "high"
    },
    planner: plannerOutput({
      riskLevel: "high"
    })
  });

  const result = await service.executePlannerOutput(USER_ID, WORKSPACE_ID, RUN_ID, {
    plannerOutput: plannerOutput({
      riskLevel: "high"
    })
  });

  assert.equal(result.status, "failed");
  assert.equal(loggingService.calls[0].input.errorCode, "AGENT_TOOL_HIGH_RISK");
}

{
  const { service, loggingService, toolRegistryService } = createService({
    registryState: {
      validationError: badRequest("start is required")
    }
  });

  const result = await service.executePlannerOutput(USER_ID, WORKSPACE_ID, RUN_ID, {
    plannerOutput: plannerOutput()
  });

  assert.equal(result.status, "failed");
  assert.equal(loggingService.calls[0].input.errorCode, "AGENT_TOOL_VALIDATION_FAILED");
  assert.equal(loggingService.calls[0].input.errorMessage, "start is required");
  assert.deepEqual(
    toolRegistryService.calls.map((call) => call.method),
    ["getDefinition", "validateInput"]
  );
}

{
  const { service, loggingService } = createService({
    registryState: {
      executionError: new Error("raw provider failure must not leak")
    }
  });

  const result = await service.executePlannerOutput(USER_ID, WORKSPACE_ID, RUN_ID, {
    plannerOutput: plannerOutput()
  });

  assert.equal(result.status, "failed");
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["startNextToolStepIfAbsent", "failStep", "failRun"]
  );
  assert.equal(
    loggingService.calls[2].input.errorMessage,
    "Agent tool execution failed"
  );
  assert.doesNotMatch(
    JSON.stringify(loggingService.calls),
    /raw provider failure must not leak/
  );
}

{
  const { registry } = createSmokeRegistry();
  const registeredToolNames = registry
    .listDefinitions()
    .map((definition) => definition.name);

  assert.deepEqual(registeredToolNames, [
    "list_calendar_events",
    "create_calendar_event",
    "update_calendar_event",
    "list_meeting_reports",
    "get_meeting_report",
    "summarize_meeting_report",
    "search_meeting_transcript",
    "search_board_issues",
    "move_board_issue_status",
    "get_board_issue_context",
    "create_board_issue",
    "resolve_board_context",
    "get_board_briefing",
    "assign_board_issue_safely",
    "diagnose_board_freshness"
  ]);
  assert.equal(
    registry.getDefinition("move_board_issue_status").executionMode,
    "confirmation_required"
  );
}

{
  const { calendarService, registry } = createSmokeRegistry();
  const { confirmationService, loggingService, service } =
    createExecutionServiceWithRegistry(
      plannerOutput({
        toolName: "update_calendar_event",
        riskLevel: "medium",
        executionMode: "confirmation_required",
        requiresConfirmation: true,
        input: {
          target: {
            title: "주간 회의",
            startDate: "2026-07-10",
            endDate: "2026-07-10",
            startTime: "15:00"
          },
          changes: {
            startTime: "16:00"
          }
        }
      }),
      registry
    );

  const result = await service.executeLatestPlannedTool(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID
  );

  assert.equal(result.status, "waiting_confirmation");
  assert.equal(confirmationService.calls[0].input.plan.target.resourceId, "1");
  assert.equal(confirmationService.calls[0].input.plan.call.eventId, "1");
  assert.equal(calendarService.calls[0].method, "listEvents");
  assert.equal(calendarService.calls[1].method, "getEvent");
  assert.deepEqual(loggingService.calls, []);
}

{
  const { calendarService, registry } = createSmokeRegistry();
  calendarService.events = [createSmokeEvent(), createSmokeEvent({ id: 2 })];
  const { confirmationService, loggingService, service } =
    createExecutionServiceWithRegistry(
      plannerOutput({
        toolName: "update_calendar_event",
        riskLevel: "medium",
        executionMode: "confirmation_required",
        requiresConfirmation: true,
        input: {
          target: {
            title: "주간 회의",
            startDate: "2026-07-10",
            endDate: "2026-07-10"
          },
          changes: { startTime: "16:00" }
        }
      }),
      registry
    );

  const result = await service.executeLatestPlannedTool(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID
  );

  assert.equal(result.status, "completed");
  assert.equal(result.run.status, "completed");
  assert.match(result.run.finalAnswer, /여러 개/);
  assert.equal(confirmationService.calls.length, 0);
  assert.deepEqual(
    loggingService.calls.map((call) => call.method),
    ["startNextToolStepIfAbsent", "completeStep", "completeRun"]
  );
  assert.equal(loggingService.calls[1].input.outputSummary.selection, "multiple");
}

{
  const { registry } = createSmokeRegistry();
  const tool = registry.getDefinition("search_board_issues");

  assert.throws(
    () => tool.validateInput({ workspaceId: "other-workspace" }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /workspaceId/);
      return true;
    }
  );
}

{
  const { boardService, registry } = createSmokeRegistry();
  const { service } = createExecutionServiceWithRegistry(
    plannerOutput({
      toolName: "search_board_issues",
      riskLevel: "low",
      executionMode: "auto",
      requiresConfirmation: false,
      input: {}
    }),
    registry
  );

  const result = await service.executeLatestPlannedTool(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID
  );

  assert.equal(result.status, "completed");
  assert.deepEqual(boardService.calls[2], {
    method: "listBoardIssues",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    boardId: "99999999-9999-4999-8999-999999999999",
    query: { page: 1, limit: 20 }
  });
}

{
  const { boardService, registry } = createSmokeRegistry();
  boardService.boards.push({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "운영",
    repository: {
      id: "repository-id-2",
      fullName: "Developer-EJ/PILO",
      htmlUrl: "https://github.com/Developer-EJ/PILO"
    },
    project: {
      id: "project-id-2",
      title: "운영",
      projectNumber: 2,
      githubProjectNodeId: "PVT_test_2",
      url: "https://github.com/orgs/Developer-EJ/projects/2"
    }
  });
  const tool = registry.getDefinition("search_board_issues");
  const result = await tool.execute(
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID, runId: RUN_ID },
    tool.validateInput({})
  );

  assert.equal(result.status, "needs_clarification");
  assert.equal(result.outputSummary.selection, "required");
  assert.equal(boardService.calls.length, 2);
}

{
  const { calendarService, registry } = createSmokeRegistry();
  const { service, loggingService, workspaceService } =
    createExecutionServiceWithRegistry(
      plannerOutput({
        toolName: "list_calendar_events",
        riskLevel: "low",
        executionMode: "auto",
        requiresConfirmation: false,
        input: {
          start: "2026-07-09",
          end: "2026-07-16"
        }
      }),
      registry
    );

  const result = await service.executeLatestPlannedTool(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID
  );

  assert.equal(result.status, "completed");
  assert.equal(result.run.status, "completed");
  assert.deepEqual(workspaceService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID }
  ]);
  assert.deepEqual(calendarService.calls[0], {
    method: "listEvents",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    query: {
      start: "2026-07-09",
      end: "2026-07-16"
    }
  });
  assert.equal(loggingService.calls[1].input.outputSummary.count, 1);
}

{
  const { registry } = createSmokeRegistry();
  const { confirmationService, loggingService, service } =
    createExecutionServiceWithRegistry(
      plannerOutput({
        toolName: "create_calendar_event",
        riskLevel: "medium",
        executionMode: "confirmation_required",
        requiresConfirmation: true,
        input: {
          title: "주간 회의",
          startDate: "2026-07-10",
          endDate: "2026-07-10",
          startTime: "15:00"
        }
      }),
      registry
    );

  const result = await service.executeLatestPlannedTool(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID
  );

  assert.equal(result.status, "waiting_confirmation");
  assert.equal(result.confirmation.status, "pending");
  assert.equal(confirmationService.calls[0].input.toolName, "create_calendar_event");
  assert.equal(confirmationService.calls[0].input.riskLevel, "medium");
  assert.equal(confirmationService.calls[0].input.plan.after.title, "주간 회의");
  assert.equal(confirmationService.calls[0].input.plan.call.method, "POST");
  assert.deepEqual(loggingService.calls, []);
}

{
  const { meetingService, registry } = createSmokeRegistry();
  const { service, loggingService } = createExecutionServiceWithRegistry(
    plannerOutput({
      toolName: "summarize_meeting_report",
      riskLevel: "low",
      executionMode: "auto",
      requiresConfirmation: false,
      input: {
        reportId: REPORT_ID
      }
    }),
    registry,
    {
      prompt: "결정사항만 알려줘",
      timezone: "Asia/Seoul"
    }
  );

  const result = await service.executeReadyRun(RUN_ID);
  const outputSummary = loggingService.calls[1].input.outputSummary;

  assert.equal(result.status, "completed");
  assert.equal(meetingService.calls[0].method, "getReport");
  assert.equal(outputSummary.report.reportId, REPORT_ID);
  assert.equal("transcript" in outputSummary.report, false);
  assert.match(result.run.finalAnswer, /결정사항: 결정사항/);
  assert.doesNotMatch(result.run.finalAnswer, /요약:/);
  assert.doesNotMatch(result.run.finalAnswer, /논의사항:/);
  assert.doesNotMatch(
    JSON.stringify(outputSummary),
    /Agent smoke test must not persist transcript text/
  );
}

{
  const { boardService, registry } = createSmokeRegistry();
  const { loggingService, service } = createExecutionServiceWithRegistry(
    plannerOutput({
      toolName: "search_board_issues",
      riskLevel: "low",
      executionMode: "auto",
      requiresConfirmation: false,
      input: {
        search: "Agent"
      }
    }),
    registry
  );

  const result = await service.executeLatestPlannedTool(
    USER_ID,
    WORKSPACE_ID,
    RUN_ID
  );

  assert.equal(result.status, "completed");
  assert.equal(boardService.calls[0].method, "getActiveBoardSource");
  assert.equal(boardService.calls[1].method, "listBoards");
  assert.equal(boardService.calls[2].method, "listBoardIssues");
  assert.match(result.run.finalAnswer, /제품 개발 Board 이슈 1개/);
  assert.match(result.run.finalAnswer, /#729/);
  assert.equal(loggingService.calls[1].input.outputSummary.issues[0].title, "Board read/search tool adapter");
}
