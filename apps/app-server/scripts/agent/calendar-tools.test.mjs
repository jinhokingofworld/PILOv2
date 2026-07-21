import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const { CalendarAgentToolsService } = require(
  "../../dist/modules/agent/tools/calendar-agent-tools.service.js"
);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

function createEvent(overrides = {}) {
  return {
    id: 1,
    title: "주간 회의",
    description: null,
    color: "#3B82F6",
    isAllDay: false,
    startDate: "2026-07-08",
    endDate: "2026-07-08",
    startTime: "15:00",
    endTime: "16:00",
    createdBy: USER_ID,
    createdByUser: {
      id: USER_ID,
      name: "Jin",
      avatarUrl: null
    },
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides
  };
}

class FakeCalendarService {
  constructor() {
    this.calls = [];
    this.events = [createEvent()];
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
    return this.refreshedEvent ?? this.events.find((event) => event.id === Number(eventId));
  }

  async createEvent(currentUserId, workspaceId, body) {
    this.calls.push({
      method: "createEvent",
      currentUserId,
      workspaceId,
      body
    });
    return createEvent(body);
  }

  normalizeCreateEventInput(body) {
    const startDate = body.startDate;
    const endDate = body.endDate ?? startDate;
    const isAllDay = body.isAllDay ?? !body.startTime;
    if (
      endDate < startDate ||
      (!isAllDay &&
        body.startTime &&
        body.endTime &&
        endDate === startDate &&
        body.endTime <= body.startTime)
    ) {
      const error = new Error("endTime must be later than startTime");
      error.getStatus = () => 400;
      error.getResponse = () => ({ error: { code: "BAD_REQUEST", message: error.message } });
      throw error;
    }
    return {
      title: body.title.trim().replace(/\s+/g, " "),
      description: body.description ?? null,
      color: body.color ?? "#3B82F6",
      isAllDay,
      startDate,
      endDate,
      startTime: isAllDay ? null : body.startTime ?? null,
      endTime: isAllDay
        ? null
        : body.endTime ?? `${String(Number(body.startTime.slice(0, 2)) + 1).padStart(2, "0")}:${body.startTime.slice(3)}`
    };
  }

  async updateEvent(currentUserId, workspaceId, eventId, body, options) {
    this.calls.push({
      method: "updateEvent",
      currentUserId,
      workspaceId,
      eventId,
      body,
      options
    });
    return createEvent({ id: Number(eventId), ...body });
  }
}

function createRegistry() {
  const calendarService = new FakeCalendarService();
  const calendarTools = new CalendarAgentToolsService(calendarService);
  const registry = new AgentToolRegistryService(calendarTools);

  return {
    calendarService,
    registry
  };
}

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID
};

function errorCode(error) {
  return error.getResponse().error.code;
}

{
  const { registry } = createRegistry();
  const definitions = registry.listDefinitions();
  const names = definitions.map((definition) => definition.name);

  assert.deepEqual(names, [
    "list_calendar_events",
    "create_calendar_event",
    "update_calendar_event"
  ]);
  assert.match(
    definitions.find((definition) => definition.name === "create_calendar_event")
      .description,
    /반복 일정은 지원하지 않습니다/
  );
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("list_calendar_events");
  const input = tool.validateInput({
    start: "2026-07-08",
    end: "2026-07-15"
  });
  const result = await tool.execute(context, input);

  assert.equal(result.outputSummary.count, 1);
  assert.equal(result.resourceRefs[0].domain, "calendar");
  assert.equal(result.resourceRefs[0].resourceId, "1");
  assert.deepEqual(calendarService.calls[0], {
    method: "listEvents",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    query: {
      start: "2026-07-08",
      end: "2026-07-15"
    }
  });
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");
  const input = tool.validateInput({
    title: "  주간 회의  ",
    isAllDay: false,
    startDate: "2026-07-08",
    endDate: "2026-07-08",
    startTime: "15:00"
  });
  const plan = await tool.buildConfirmation(context, input);
  const result = await tool.execute(context, input);

  assert.equal(plan.toolName, "create_calendar_event");
  assert.equal(plan.before, null);
  assert.equal(plan.after.title, "주간 회의");
  assert.equal(plan.after.color, "#3B82F6");
  assert.equal(plan.call.service, "CalendarService.createEvent");
  assert.equal(result.status, "created");
  assert.deepEqual(calendarService.calls[0].body, {
    title: "주간 회의",
    description: null,
    color: "#3B82F6",
    isAllDay: false,
    startDate: "2026-07-08",
    endDate: "2026-07-08",
    startTime: "15:00",
    endTime: "16:00"
  });
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");
  const input = tool.validateInput({
    title: "주간 회의",
    startDate: "2026-07-08",
    endDate: "2026-07-08",
    startTime: "15:00"
  });
  await tool.execute(context, input);

  assert.equal(input.isAllDay, false);
  assert.deepEqual(calendarService.calls[0].body, {
    title: "주간 회의",
    description: null,
    color: "#3B82F6",
    isAllDay: false,
    startDate: "2026-07-08",
    endDate: "2026-07-08",
    startTime: "15:00",
    endTime: "16:00"
  });
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");
  const input = tool.validateInput({
    title: "종료일 없는 일정",
    startDate: "2026-07-08"
  });

  assert.equal(input.isAllDay, true);
  assert.equal(input.endDate, "2026-07-08");
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");
  const input = tool.validateInput({
    target: {
      title: " 주간   회의 ",
      startDate: "2026-07-08",
      endDate: "2026-07-08",
      startTime: "15:00"
    },
    changes: {
      startTime: "16:00",
      endTime: "17:00"
    }
  });
  const plan = await tool.buildConfirmation(context, input);
  assert.equal(plan.call.expectedUpdatedAt, "2026-07-08T00:00:00.000Z");
  const legacyPlan = structuredClone(plan);
  delete legacyPlan.call.expectedUpdatedAt;
  assert.throws(
    () => tool.buildConfirmationInput(legacyPlan),
    (error) => /updatedAt|stale/i.test(error.getResponse().error.message)
  );
  const result = await tool.execute(
    context,
    tool.validateConfirmationInput(tool.buildConfirmationInput(plan))
  );

  assert.equal(plan.toolName, "update_calendar_event");
  assert.equal(plan.target.resourceId, "1");
  assert.equal(plan.before.title, "주간 회의");
  assert.equal(plan.before.color, "#3B82F6");
  assert.deepEqual(plan.after, {
    startTime: "16:00",
    endTime: "17:00"
  });
  assert.equal(result.status, "updated");
  assert.deepEqual(calendarService.calls[0], {
    method: "listEvents",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    query: {
      start: "2026-07-08",
      end: "2026-07-08"
    }
  });
  assert.deepEqual(calendarService.calls[1], {
    method: "getEvent",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    eventId: "1"
  });
  assert.deepEqual(calendarService.calls[2].body, {
    startTime: "16:00",
    endTime: "17:00"
  });
  assert.deepEqual(calendarService.calls[2].options, {
    expectedUpdatedAt: "2026-07-08T00:00:00.000Z"
  });
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");
  calendarService.events = [];
  const result = await tool.buildConfirmation(
    context,
    tool.validateInput({
      target: {
        title: "주간 회의",
        startDate: "2026-07-08",
        endDate: "2026-07-08"
      },
      changes: { title: "주간 회의 수정" }
    })
  );

  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.selection, "none");
  assert.equal(calendarService.calls.length, 1);
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");
  calendarService.refreshedEvent = createEvent({ title: "변경된 제목" });
  const result = await tool.buildConfirmation(
    context,
    tool.validateInput({
      target: {
        title: "주간 회의",
        startDate: "2026-07-08",
        endDate: "2026-07-08"
      },
      changes: { title: "주간 회의 수정" }
    })
  );

  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.selection, "none");
  assert.deepEqual(
    calendarService.calls.map((call) => call.method),
    ["listEvents", "getEvent"]
  );
}

{
  const { calendarService, registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");
  calendarService.events = [createEvent(), createEvent({ id: 2 })];
  const result = await tool.buildConfirmation(
    context,
    tool.validateInput({
      target: {
        title: "주간 회의",
        startDate: "2026-07-08",
        endDate: "2026-07-08"
      },
      changes: { title: "주간 회의 수정" }
    })
  );

  assert.equal(result.kind, "needs_clarification");
  assert.equal(result.outputSummary.selection, "multiple");
  assert.equal(result.resourceRefs.length, 2);
  assert.equal(calendarService.calls.length, 1);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        eventId: "1",
        changes: { title: "주간 회의 수정" }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.match(error.getResponse().error.message, /target/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        workspaceId: WORKSPACE_ID,
        target: {
          title: "주간 회의",
          startDate: "2026-07-08",
          endDate: "2026-07-08"
        },
        changes: { title: "주간 회의 수정" }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.match(error.getResponse().error.message, /workspaceId/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        title: "주간 회의",
        workspaceId: WORKSPACE_ID,
        startDate: "2026-07-08",
        endDate: "2026-07-08"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /workspaceId/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        title: "가족 일정",
        isAllDay: false,
        startDate: "2026-07-12",
        endDate: "2026-07-12",
        startTime: "19:00",
        endTime: "19:00"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /endTime/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        title: "주간 회의",
        isAllDay: false,
        startDate: "2026-07-08",
        endDate: "2026-07-08"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /startTime/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("create_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        title: "주간 회의",
        isAllDay: true,
        startDate: "2026-07-08",
        endDate: "2026-07-08",
        startTime: "15:00"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /all-day events/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        target: {
          title: "주간 회의",
          startDate: "2026-07-08",
          endDate: "2026-07-08"
        },
        before: { title: "LLM이 만든 현재값" },
        changes: { startTime: "16:00" }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /before/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("update_calendar_event");

  assert.throws(
    () =>
      tool.validateInput({
        target: {
          title: "주간 회의",
          startDate: "2026-07-08",
          endDate: "2026-07-08"
        },
        changes: {
          unsupported: "value"
        }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /unsupported/);
      return true;
    }
  );
}
