import assert from "node:assert/strict";
import test from "node:test";

import { getCalendarWeekEventBars } from "./calendar-event-bars.ts";

function createEvent(id, startDate, endDate) {
  return {
    id,
    title: `일정 ${id}`,
    description: null,
    color: "#3B82F6",
    isAllDay: true,
    startDate,
    endDate,
    startTime: null,
    endTime: null,
    createdBy: "user-1",
    createdByUser: { id: "user-1", name: "세인", avatarUrl: null },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z"
  };
}

test("겹치는 기간 일정은 주 안에서 서로 다른 lane에 배치한다", () => {
  const weeks = getCalendarWeekEventBars(
    [
      createEvent(1, "2026-07-13", "2026-07-16"),
      createEvent(2, "2026-07-15", "2026-07-17"),
      createEvent(3, "2026-07-17", "2026-07-18")
    ],
    [
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18"
    ]
  );

  assert.equal(weeks[0].laneCount, 2);
  assert.deepEqual(
    weeks[0].segments.map(({ endColumn, event, lane, startColumn }) => ({
      endColumn,
      eventId: event.id,
      lane,
      startColumn
    })),
    [
      { eventId: 1, lane: 0, startColumn: 2, endColumn: 5 },
      { eventId: 2, lane: 1, startColumn: 4, endColumn: 6 },
      { eventId: 3, lane: 0, startColumn: 6, endColumn: 7 }
    ]
  );
});

test("주 경계를 넘는 기간 일정은 각 주에서 이어지는 segment가 된다", () => {
  const weeks = getCalendarWeekEventBars(
    [createEvent(1, "2026-07-17", "2026-07-21")],
    [
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25"
    ]
  );

  assert.deepEqual(weeks[0].segments[0], {
    continuesFromPreviousWeek: false,
    continuesToNextWeek: true,
    endColumn: 7,
    event: createEvent(1, "2026-07-17", "2026-07-21"),
    lane: 0,
    startColumn: 6,
    weekIndex: 0
  });
  assert.deepEqual(weeks[1].segments[0], {
    continuesFromPreviousWeek: true,
    continuesToNextWeek: false,
    endColumn: 3,
    event: createEvent(1, "2026-07-17", "2026-07-21"),
    lane: 0,
    startColumn: 1,
    weekIndex: 1
  });
});
