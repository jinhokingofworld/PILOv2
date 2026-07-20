"use client";

import { useMemo } from "react";

import { useAuthSession } from "@/features/auth/auth-session";
import { HomeWorkspaceLocationAdapter } from "@/features/home/home-workspace-location-adapter";
import { PageCursorSurface } from "@/shared/page-cursor/PageCursorSurface";
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
    <PageCursorSurface
      className="relative flex min-h-0 flex-1 flex-col bg-[#f6f7f9] p-4 sm:p-5"
      enabled={Boolean(authSession?.activeWorkspaceId)}
      page="home"
      workspaceId={authSession?.activeWorkspaceId ?? ""}
    >
      <HomeWorkspaceLocationAdapter />
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
        <section className="grid gap-4 xl:grid-cols-[minmax(260px,0.66fr)_minmax(0,1.34fr)]">
          <MembersCard />
          <CalendarCard
            calendarDates={calendarDates}
            calendarEventsState={calendarEventsState}
            today={today}
          />
        </section>
        <section className="space-y-3">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#202124]">
              워크스페이스 현황
            </h2>
            <p className="mt-1 text-[13px] text-[#6b6f78]">
              진행 중인 작업과 최근 기록을 한눈에 확인하세요.
            </p>
          </div>
          <MiddleDashboardCards
            issuesState={issuesState}
            meetingReportsState={meetingReportsState}
            pullRequestsState={pullRequestsState}
          />
        </section>
        <div className="min-h-[128px] [&>div]:min-h-[128px]">
          <GithubWorkspaceCards />
        </div>
      </div>
    </PageCursorSurface>
  );
}
