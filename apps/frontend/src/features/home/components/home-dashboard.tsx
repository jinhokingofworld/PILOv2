"use client";

import { useMemo } from "react";

import { useAuthSession } from "@/features/auth/auth-session";
import { CalendarCard } from "./calendar-card";
import { GithubWorkspaceCards } from "./shortcut-cards";
import { MembersCard } from "./members-card";
import { MiddleDashboardCards } from "./middle-dashboard-cards";
import {
  useHomeIssues,
  useHomeMeetingReports,
  useHomePullRequests,
  useHomeWeekCalendarEvents
} from "../hooks/use-home-dashboard-data";
import { formatCalendarDate, getCalendarRangeDates } from "../utils/home-date";

export function HomeDashboard() {
  const authSession = useAuthSession();
  const today = useMemo(() => new Date(), []);
  const calendarDates = useMemo(() => getCalendarRangeDates(today, 14), [today]);
  const calendarRange = useMemo(
    () => ({
      end: formatCalendarDate(calendarDates[calendarDates.length - 1]),
      start: formatCalendarDate(calendarDates[0])
    }),
    [calendarDates]
  );
  const calendarEventsState = useHomeWeekCalendarEvents({
    accessToken: authSession?.accessToken ?? null,
    range: calendarRange,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const issuesState = useHomeIssues({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const pullRequestsState = useHomePullRequests({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });
  const meetingReportsState = useHomeMeetingReports({
    accessToken: authSession?.accessToken ?? null,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-4 2xl:grid-cols-[0.9fr_1.75fr_1fr] 2xl:grid-rows-[minmax(0,330px)_minmax(272px,1fr)_128px]">
        <MembersCard />
        <CalendarCard
          calendarDates={calendarDates}
          calendarEventsState={calendarEventsState}
          today={today}
        />
        <MiddleDashboardCards
          issuesState={issuesState}
          meetingReportsState={meetingReportsState}
          pullRequestsState={pullRequestsState}
        />
        <GithubWorkspaceCards />
      </div>
    </section>
  );
}
