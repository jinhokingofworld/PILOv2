import type { CalendarEvent } from "./types";

export type CalendarEventBarSegment = {
  continuesFromPreviousWeek: boolean;
  continuesToNextWeek: boolean;
  endColumn: number;
  event: CalendarEvent;
  lane: number;
  startColumn: number;
  weekIndex: number;
};

export type CalendarWeekEventBars = {
  dates: string[];
  laneCount: number;
  segments: CalendarEventBarSegment[];
};

export function getCalendarDateBarLayout(
  segments: CalendarEventBarSegment[],
  column: number
) {
  const coveringSegments = segments.filter(
    (segment) =>
      segment.startColumn <= column && segment.endColumn >= column
  );

  return {
    connectsToNext: coveringSegments.some(
      (segment) => segment.endColumn > column
    ),
    connectsToPrevious: coveringSegments.some(
      (segment) => segment.startColumn < column
    ),
    laneCount: coveringSegments.reduce(
      (count, segment) => Math.max(count, segment.lane + 1),
      0
    )
  };
}

function compareBarEvents(a: CalendarEvent, b: CalendarEvent) {
  const startCompare = a.startDate.localeCompare(b.startDate);
  if (startCompare !== 0) {
    return startCompare;
  }

  const endCompare = b.endDate.localeCompare(a.endDate);
  if (endCompare !== 0) {
    return endCompare;
  }

  const createdAtCompare = a.createdAt.localeCompare(b.createdAt);
  if (createdAtCompare !== 0) {
    return createdAtCompare;
  }

  return a.title.localeCompare(b.title);
}

function isMultiDayEvent(event: CalendarEvent) {
  return event.startDate < event.endDate;
}

export function getCalendarWeekEventBars(
  events: CalendarEvent[],
  gridDates: string[]
): CalendarWeekEventBars[] {
  const weeks = Array.from(
    { length: Math.floor(gridDates.length / 7) },
    (_, weekIndex) => gridDates.slice(weekIndex * 7, weekIndex * 7 + 7)
  );
  const multiDayEvents = events.filter(isMultiDayEvent);

  return weeks.map((dates, weekIndex) => {
    const weekStart = dates[0];
    const weekEnd = dates[dates.length - 1];
    if (!weekStart || !weekEnd) {
      return { dates, laneCount: 0, segments: [] };
    }

    const laneEndColumns: number[] = [];
    const segments = multiDayEvents
      .filter((event) => event.startDate <= weekEnd && event.endDate >= weekStart)
      .sort(compareBarEvents)
      .map((event) => {
        const startColumn = Math.max(
          dates.findIndex((date) => date >= event.startDate),
          0
        );
        const endColumn = dates.reduce(
          (lastIndex, date, index) =>
            date <= event.endDate ? index : lastIndex,
          startColumn
        );
        const lane = laneEndColumns.findIndex(
          (laneEndColumn) => laneEndColumn < startColumn
        );
        const assignedLane = lane === -1 ? laneEndColumns.length : lane;

        laneEndColumns[assignedLane] = endColumn;

        return {
          continuesFromPreviousWeek: event.startDate < weekStart,
          continuesToNextWeek: event.endDate > weekEnd,
          endColumn: endColumn + 1,
          event,
          lane: assignedLane,
          startColumn: startColumn + 1,
          weekIndex
        };
      });

    return {
      dates,
      laneCount: laneEndColumns.length,
      segments
    };
  });
}
