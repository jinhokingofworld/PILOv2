"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createCalendarApiClient } from "@/features/calendar/api/client";
import { getCalendarMonthGridRange } from "@/features/calendar/calendar-date-range";
import type { CalendarEvent } from "@/features/calendar/types";

export {
  formatCalendarDate,
  getCalendarMonthGridRange,
  getCalendarMonthRange
} from "@/features/calendar/calendar-date-range";

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

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Calendar events could not be loaded");
}

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
