import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const appServerRoot = new URL("../..", import.meta.url);
const tscScript = fileURLToPath(
  new URL("../../node_modules/typescript/bin/tsc", import.meta.url)
);

execFileSync(process.execPath, [tscScript, "-p", "tsconfig.build.json"], {
  cwd: appServerRoot,
  stdio: "inherit"
});

const require = createRequire(import.meta.url);
const { CalendarService } = require("../../dist/modules/calendar/calendar.service.js");

const currentUserId = "user-1";
const workspaceId = "workspace-1";
const createdAt = new Date("2026-07-03T00:00:00.000Z");
const updatedAt = new Date("2026-07-03T01:00:00.000Z");

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }

  async transaction(callback) {
    return callback(this);
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }
}

class FakeActivityLogService {
  constructor() {
    this.calls = [];
  }

  async append(transaction, input) {
    this.calls.push({ transaction, input });
  }
}

class FakeGoogleCalendarSyncService {
  constructor() {
    this.calls = [];
  }

  async enqueueUpdatedEventInTransaction(transaction, workspaceId, event) {
    this.calls.push({ transaction, workspaceId, event });
  }
}

function createSubject(
  database = new FakeDatabase(),
  googleCalendarSyncService
) {
  const workspaceService = new FakeWorkspaceService();
  const activityLogService = new FakeActivityLogService();
  const service = new CalendarService(
    database,
    workspaceService,
    activityLogService,
    googleCalendarSyncService
  );
  return {
    activityLogService,
    database,
    googleCalendarSyncService,
    service,
    workspaceService
  };
}

function calendarRow(overrides = {}) {
  return {
    id: 1,
    title: "Team meeting",
    description: "Weekly sync",
    color: "#3B82F6",
    is_all_day: false,
    start_date: "2026-07-03",
    end_date: "2026-07-03",
    start_time: "14:00:00",
    end_time: "15:00:00",
    created_by: currentUserId,
    created_by_user_name: "Sein",
    created_by_user_avatar_url: "https://example.com/avatar.png",
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides
  };
}

async function assertBadRequest(action, messagePattern) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), 400);
    assert.equal(error.getResponse().error.code, "BAD_REQUEST");
    assert.match(error.getResponse().error.message, messagePattern);
    return true;
  });
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      calendarRow({
        title: "Existing event",
        updated_at: new Date("2026-07-03T02:00:00.000Z")
      }),
      calendarRow({
        title: "Changed event",
        updated_at: new Date("2026-07-03T03:00:00.000Z")
      })
    ]
  });
  const googleCalendarSyncService = new FakeGoogleCalendarSyncService();
  const { activityLogService, service } = createSubject(
    database,
    googleCalendarSyncService
  );

  await assert.rejects(
    () =>
      service.updateEvent(
        currentUserId,
        workspaceId,
        "1",
        { title: "Changed event" },
        { expectedUpdatedAt: "2026-07-03T01:00:00.000Z" }
      ),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.match(error.getResponse().error.message, /changed|updatedAt/i);
      return true;
    }
  );
  assert.equal(
    database.queries.some(({ text }) => /UPDATE calendar_events/.test(text)),
    false
  );
  assert.equal(activityLogService.calls.length, 0);
  assert.equal(googleCalendarSyncService.calls.length, 0);
}

{
  const database = new FakeDatabase({
    queryRows: [
      (text, values) => {
        assert.match(text, /calendar_events\.start_date <= \$3/);
        assert.match(text, /calendar_events\.end_date >= \$2/);
        assert.deepEqual(values, [workspaceId, "2026-07-01", "2026-07-31"]);
        return [
          calendarRow({
            id: 7,
            start_date: new Date("2026-07-03T00:00:00.000Z"),
            end_date: new Date("2026-07-03T00:00:00.000Z")
          })
        ];
      }
    ]
  });
  const { service, workspaceService } = createSubject(database);

  const events = await service.listEvents(currentUserId, workspaceId, {
    start: "2026-07-01",
    end: "2026-07-31"
  });

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(events, [
    {
      id: 7,
      title: "Team meeting",
      description: "Weekly sync",
      color: "#3B82F6",
      isAllDay: false,
      startDate: "2026-07-03",
      endDate: "2026-07-03",
      startTime: "14:00",
      endTime: "15:00",
      createdBy: currentUserId,
      createdByUser: {
        id: currentUserId,
        name: "Sein",
        avatarUrl: "https://example.com/avatar.png"
      },
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T01:00:00.000Z",
      googleSync: null
    }
  ]);
}

{
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Asia/Seoul";
  try {
    const localCalendarDate = new Date(2026, 6, 22);
    const database = new FakeDatabase({
      queryRows: [
        [
          calendarRow({
            id: 8,
            start_date: localCalendarDate,
            end_date: localCalendarDate
          })
        ]
      ]
    });
    const { service } = createSubject(database);

    const [event] = await service.listEvents(currentUserId, workspaceId, {
      start: "2026-07-22",
      end: "2026-07-22"
    });

    assert.equal(event.startDate, "2026-07-22");
    assert.equal(event.endDate, "2026-07-22");
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO calendar_events/);
        assert.deepEqual(values, [
          workspaceId,
          "Team meeting",
          null,
          "#3B82F6",
          false,
          "2026-07-03",
          "2026-07-03",
          "14:00",
          "15:00",
          currentUserId
        ]);
        return calendarRow({
          title: "Team meeting",
          description: null
        });
      }
    ]
  });
  const { activityLogService, service } = createSubject(database);

  const event = await service.createEvent(currentUserId, workspaceId, {
    title: " Team meeting ",
    isAllDay: false,
    startDate: "2026-07-03",
    endDate: "2026-07-03",
    startTime: "14:00"
  });

  assert.equal(event.title, "Team meeting");
  assert.equal(event.endDate, "2026-07-03");
  assert.equal(event.endTime, "15:00");
  assert.deepEqual(activityLogService.calls, [
    {
      transaction: database,
      input: {
        workspaceId,
        actor: { type: "user", userId: currentUserId },
        action: "calendar_event_created",
        target: { type: "calendar_event", id: "1" },
        dedupeKey: "calendar:calendar_event_created:1",
        metadata: {
          version: 1,
          summary: "일정을 생성했습니다.",
          data: { title: "Team meeting" }
        }
      }
    }
  ]);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      calendarRow({
        title: "Existing event",
        color: "#111111"
      }),
      calendarRow({
        title: "Existing event",
        color: "#111111"
      })
    ]
  });
  const { activityLogService, service } = createSubject(database);

  await service.updateEvent(currentUserId, workspaceId, "1", {
    color: "#111111"
  });

  assert.deepEqual(activityLogService.calls, []);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO calendar_events/);
        assert.equal(values[5], "2026-07-03");
        assert.equal(values[6], "2026-07-03");
        return calendarRow({
          title: "종료일 없는 종일 일정",
          is_all_day: true,
          start_time: null,
          end_time: null
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const event = await service.createEvent(currentUserId, workspaceId, {
    title: "종료일 없는 종일 일정",
    startDate: "2026-07-03"
  });

  assert.equal(event.endDate, "2026-07-03");
  assert.equal(event.startTime, null);
  assert.equal(event.endTime, null);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO calendar_events/);
        assert.deepEqual(values, [
          workspaceId,
          "Late deploy",
          null,
          "#3B82F6",
          false,
          "2026-07-03",
          "2026-07-04",
          "23:30",
          "00:30",
          currentUserId
        ]);
        return calendarRow({
          title: "Late deploy",
          end_date: "2026-07-04",
          start_time: "23:30:00",
          end_time: "00:30:00"
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const event = await service.createEvent(currentUserId, workspaceId, {
    title: "Late deploy",
    isAllDay: false,
    startDate: "2026-07-03",
    endDate: "2026-07-03",
    startTime: "23:30"
  });

  assert.equal(event.endDate, "2026-07-04");
  assert.equal(event.endTime, "00:30");
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO calendar_events/);
        assert.deepEqual(values, [
          workspaceId,
          "Conference",
          null,
          "#3B82F6",
          false,
          "2026-07-03",
          "2026-07-05",
          "09:00",
          "10:00",
          currentUserId
        ]);
        return calendarRow({
          title: "Conference",
          end_date: "2026-07-05",
          start_time: "09:00:00",
          end_time: "10:00:00"
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const event = await service.createEvent(currentUserId, workspaceId, {
    title: "Conference",
    isAllDay: false,
    startDate: "2026-07-03",
    endDate: "2026-07-05",
    startTime: "09:00"
  });

  assert.equal(event.endDate, "2026-07-05");
  assert.equal(event.endTime, "10:00");
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text) => {
        assert.match(text, /LEFT JOIN calendar_event_google_syncs/);
        assert.match(text, /FOR UPDATE OF calendar_events/);
        return calendarRow({
          title: "Existing event",
          description: "Before",
          color: "#111111",
          start_time: "14:00:00",
          end_time: "15:00:00"
        });
      },
      (text, values) => {
        assert.match(text, /UPDATE calendar_events/);
        assert.deepEqual(values, [
          workspaceId,
          1,
          "Existing event",
          "Before",
          "#111111",
          false,
          "2026-07-03",
          "2026-07-03",
          "16:00",
          "17:00"
        ]);
        return calendarRow({
          title: "Existing event",
          description: "Before",
          color: "#111111",
          start_time: "16:00:00",
          end_time: "17:00:00"
        });
      }
    ]
  });
  const { activityLogService, service } = createSubject(database);

  const event = await service.updateEvent(currentUserId, workspaceId, "1", {
    startTime: "16:00"
  });

  assert.equal(event.startTime, "16:00");
  assert.equal(event.endTime, "17:00");
  assert.deepEqual(activityLogService.calls, [
    {
      transaction: database,
      input: {
        workspaceId,
        actor: { type: "user", userId: currentUserId },
        action: "calendar_event_updated",
        target: { type: "calendar_event", id: "1" },
        dedupeKey: "calendar:calendar_event_updated:1:2026-07-03T01:00:00.000Z",
        metadata: {
          version: 1,
          summary: "Existing event 일정을 변경했습니다.",
          data: {
            title: "Existing event",
            changedFields: ["startTime", "endTime"],
            before: { startTime: "14:00", endTime: "15:00" },
            after: { startTime: "16:00", endTime: "17:00" }
          }
        }
      }
    }
  ]);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      calendarRow({
        title: "Existing event",
        start_date: "2026-07-03",
        end_date: "2026-07-03",
        start_time: "14:00:00",
        end_time: "15:00:00"
      }),
      (text, values) => {
        assert.match(text, /UPDATE calendar_events/);
        assert.equal(values[7], "2026-07-05");
        assert.equal(values[8], "14:00");
        assert.equal(values[9], "15:00");
        return calendarRow({
          title: "Existing event",
          start_date: "2026-07-03",
          end_date: "2026-07-05",
          start_time: "14:00:00",
          end_time: "15:00:00"
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const event = await service.updateEvent(currentUserId, workspaceId, "1", {
    endDate: "2026-07-05"
  });

  assert.equal(event.endDate, "2026-07-05");
  assert.equal(event.startTime, "14:00");
  assert.equal(event.endTime, "15:00");
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      calendarRow({
        title: "Existing event",
        start_time: "14:00:00",
        end_time: "15:00:00"
      }),
      (text, values) => {
        assert.match(text, /UPDATE calendar_events/);
        assert.equal(values[8], "16:00");
        assert.equal(values[9], "18:30");
        return calendarRow({
          title: "Existing event",
          start_time: "16:00:00",
          end_time: "18:30:00"
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const event = await service.updateEvent(currentUserId, workspaceId, "1", {
    startTime: "16:00",
    endTime: "18:30"
  });

  assert.equal(event.startTime, "16:00");
  assert.equal(event.endTime, "18:30");
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO calendar_events/);
        assert.deepEqual(values, [
          workspaceId,
          "Offsite",
          null,
          "#3B82F6",
          true,
          "2026-07-03",
          "2026-07-03",
          null,
          null,
          currentUserId
        ]);
        return calendarRow({
          title: "Offsite",
          is_all_day: true,
          start_time: null,
          end_time: null
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const event = await service.createEvent(currentUserId, workspaceId, {
    title: "Offsite",
    isAllDay: true,
    startDate: "2026-07-03",
    endDate: "2026-07-03",
    startTime: "09:00",
    endTime: "18:00"
  });

  assert.equal(event.isAllDay, true);
  assert.equal(event.startTime, null);
  assert.equal(event.endTime, null);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text) => {
        assert.match(text, /LEFT JOIN calendar_event_google_syncs/);
        assert.match(text, /FOR UPDATE OF calendar_events/);
        return calendarRow({
          id: 3,
          title: "Deleted event"
        });
      },
      (text, values) => {
        assert.match(text, /DELETE FROM calendar_events/);
        assert.deepEqual(values, [workspaceId, 3]);
        return { id: "3" };
      }
    ]
  });
  const { activityLogService, service } = createSubject(database);

  const result = await service.deleteEvent(currentUserId, workspaceId, "3");

  assert.deepEqual(result, { id: 3 });
  assert.deepEqual(activityLogService.calls, [
    {
      transaction: database,
      input: {
        workspaceId,
        actor: { type: "user", userId: currentUserId },
        action: "calendar_event_deleted",
        target: { type: "calendar_event", id: "3" },
        dedupeKey: "calendar:calendar_event_deleted:3:2026-07-03T01:00:00.000Z",
        metadata: {
          version: 1,
          summary: "Deleted event 일정을 삭제했습니다.",
          data: { title: "Deleted event" }
        }
      }
    }
  ]);
}

{
  const { database, service } = createSubject();

  await assertBadRequest(
    () =>
      service.createEvent(currentUserId, workspaceId, {
        title: "   ",
        startDate: "2026-07-03",
        endDate: "2026-07-03"
      }),
    /title is required/
  );

  await assertBadRequest(
    () =>
      service.createEvent(currentUserId, workspaceId, {
        title: "Bad color",
        color: "blue",
        startDate: "2026-07-03",
        endDate: "2026-07-03"
      }),
    /color must be a hex color/
  );

  await assertBadRequest(
    () =>
      service.createEvent(currentUserId, workspaceId, {
        title: "Bad dates",
        startDate: "2026-07-04",
        endDate: "2026-07-03"
      }),
    /endDate must be on or after startDate/
  );

  await assertBadRequest(
    () =>
      service.createEvent(currentUserId, workspaceId, {
        title: "Missing start",
        isAllDay: false,
        startDate: "2026-07-03",
        endDate: "2026-07-03"
      }),
    /startTime is required/
  );

  await assertBadRequest(
    () =>
      service.createEvent(currentUserId, workspaceId, {
        title: "Bad time",
        isAllDay: false,
        startDate: "2026-07-03",
        endDate: "2026-07-03",
        startTime: "24:00"
      }),
    /startTime must use HH:mm format/
  );

  await assertBadRequest(
    () =>
      service.createEvent(currentUserId, workspaceId, {
        title: "Backwards time",
        isAllDay: false,
        startDate: "2026-07-03",
        endDate: "2026-07-03",
        startTime: "14:00",
        endTime: "13:00"
      }),
    /endTime must be later than startTime/
  );

  await assertBadRequest(
    () => service.deleteEvent(currentUserId, workspaceId, "abc"),
    /eventId must be a positive integer/
  );

  assert.equal(database.queries.length, 0);
}
