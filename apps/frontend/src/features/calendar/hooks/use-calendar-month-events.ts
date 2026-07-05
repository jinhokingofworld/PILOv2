"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createCalendarApiClient } from "@/features/calendar/api/client";
import type { CalendarEvent } from "@/features/calendar/types";

export type CalendarMonthEventsStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

type CalendarMonthEventsState = {
  events: CalendarEvent[];
  status: CalendarMonthEventsStatus;
  error: Error | null;
};

type UseCalendarMonthEventsOptions = {
  workspaceId: string;
  accessToken?: string | null;
  monthDate?: Date;
  enabled?: boolean;
};

const idleState: CalendarMonthEventsState = {
  events: [],
  status: "idle",
  error: null
};
const calendarGridWeekCount = 6;
const calendarWeekdayCount = 7;

function padDatePart(value: number) {
  return value.toString().padStart(2, "0");
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Calendar events could not be loaded");
}

export function formatCalendarDate(date: Date) {
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join("-");
}

function addCalendarDays(date: Date, dayOffset: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
}

export function getCalendarMonthGridRange(monthDate: Date) {
  const monthStartDate = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth(),
    1
  );
  const gridStartDate = addCalendarDays(
    monthStartDate,
    -monthStartDate.getDay()
  );
  const gridEndDate = addCalendarDays(
    gridStartDate,
    calendarGridWeekCount * calendarWeekdayCount - 1
  );

  return {
    start: formatCalendarDate(gridStartDate),
    end: formatCalendarDate(gridEndDate)
  };
}

export const getCalendarMonthRange = getCalendarMonthGridRange;

export function useCalendarMonthEvents({
  workspaceId,
  accessToken = null,
  monthDate,
  enabled = true
}: UseCalendarMonthEventsOptions) {
  const [state, setState] = useState<CalendarMonthEventsState>(idleState);
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedAccessToken = accessToken?.trim() || null;
  const targetMonth = useMemo(() => monthDate ?? new Date(), [monthDate]);
  const monthKey = getMonthKey(targetMonth);
  const range = useMemo(
    () => getCalendarMonthGridRange(targetMonth),
    [monthKey]
  );
  const calendarClient = useMemo(
    () => createCalendarApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );

  const fetchEvents = useCallback(async (): Promise<CalendarMonthEventsState> => {
    if (!enabled || !normalizedWorkspaceId || !normalizedAccessToken) {
      return idleState;
    }

    try {
      const events = await calendarClient.listEvents(normalizedWorkspaceId, range);

      return {
        events,
        status: "success",
        error: null
      };
    } catch (error) {
      return {
        events: [],
        status: "error",
        error: errorFromUnknown(error)
      };
    }
  }, [
    calendarClient,
    enabled,
    normalizedAccessToken,
    normalizedWorkspaceId,
    range
  ]);

  const reload = useCallback(async () => {
    setState((currentState) => ({
      ...currentState,
      status: normalizedWorkspaceId && normalizedAccessToken ? "loading" : "idle",
      error: null
    }));
    setState(await fetchEvents());
  }, [fetchEvents, normalizedAccessToken, normalizedWorkspaceId]);

  useEffect(() => {
    let active = true;

    async function loadEvents() {
      if (!enabled || !normalizedWorkspaceId || !normalizedAccessToken) {
        setState(idleState);
        return;
      }

      setState((currentState) => ({
        ...currentState,
        status: "loading",
        error: null
      }));

      const nextState = await fetchEvents();
      if (active) {
        setState(nextState);
      }
    }

    void loadEvents();

    return () => {
      active = false;
    };
  }, [enabled, fetchEvents, normalizedAccessToken, normalizedWorkspaceId]);

  return {
    ...state,
    range,
    reload
  };
}
