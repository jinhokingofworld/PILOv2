"use client";

import type { ReactNode } from "react";
import { CalendarDays, FileText, GitPullRequest, ListChecks } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  homeIssueListLimit,
  homeMeetingReportListLimit,
  homePullRequestListLimit,
  type HomeIssuesState,
  type HomeMeetingReportsState,
  type HomePullRequestsState,
  type HomeWeekCalendarEventsState
} from "../hooks/use-home-dashboard-data";
import {
  formatCalendarDate,
  getCappedProgressPercent,
  isCalendarEventOnDate
} from "../utils/home-date";
import {
  SummaryCalendarBackground,
  SummaryIssuesBackground,
  SummaryMeetingReportsBackground,
  SummaryPullRequestsBackground
} from "./home-backgrounds";

export function SummaryMetricsPanel({
  calendarEventsState,
  issuesState,
  meetingReportsState,
  pullRequestsState,
  today
}: {
  calendarEventsState: HomeWeekCalendarEventsState;
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
  today: Date;
}) {
  const summaryItems = getHomeSummaryItems({
    calendarEventsState,
    issuesState,
    meetingReportsState,
    pullRequestsState,
    today
  });

  return (
    <div className="grid h-full min-h-0 grid-rows-4 gap-3 overflow-hidden 2xl:col-start-3 2xl:row-start-1">
      {summaryItems.map((item) => (
        <SummaryMetricCard key={item.label} item={item} variant="compact" />
      ))}
    </div>
  );
}

function getHomeSummaryItems({
  calendarEventsState,
  issuesState,
  meetingReportsState,
  pullRequestsState,
  today
}: {
  calendarEventsState: HomeWeekCalendarEventsState;
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
  today: Date;
}) {
  const todayDate = formatCalendarDate(today);
  const todayEventCount = calendarEventsState.events.filter((event) =>
    isCalendarEventOnDate(event, todayDate)
  ).length;
  const issueCount =
    issuesState.status === "loading" ? "-" : String(issuesState.total);
  const issueSummaryLabel =
    issuesState.mode === "assigned" ? "내 이슈" : "최근 이슈";
  const pullRequestCount =
    pullRequestsState.status === "loading" ? "-" : String(pullRequestsState.total);
  const meetingReportCount =
    meetingReportsState.status === "loading"
      ? "-"
      : String(meetingReportsState.todayCount);

  return [
    {
      icon: <CalendarDays className="size-4" />,
      label: "오늘 일정",
      value: String(todayEventCount),
      background: <SummaryCalendarBackground />,
      className:
        "border-[#B7DCD7] bg-[#F4FBFA] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress: getCappedProgressPercent(todayEventCount, 5),
      tone: "calendar"
    },
    {
      icon: <ListChecks className="size-4" />,
      label: issueSummaryLabel,
      value: issueCount,
      background: <SummaryIssuesBackground />,
      className:
        "border-[#D8D1FF] bg-[#F7F5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress:
        issuesState.status === "loading"
          ? "0%"
          : getCappedProgressPercent(issuesState.total, homeIssueListLimit),
      tone: "issues"
    },
    {
      icon: <GitPullRequest className="size-4" />,
      label: "리뷰 대기",
      value: pullRequestCount,
      background: <SummaryPullRequestsBackground />,
      className:
        "border-[#C8CCF2] bg-[#F5F6FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress:
        pullRequestsState.status === "loading"
          ? "0%"
          : getCappedProgressPercent(
              pullRequestsState.total,
              homePullRequestListLimit
            ),
      tone: "pullRequests"
    },
    {
      icon: <FileText className="size-4" />,
      label: "최근 생성된 회의록",
      value: meetingReportCount,
      background: <SummaryMeetingReportsBackground />,
      className:
        "border-[#CBEFBD] bg-[#F5FCF2] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]",
      progress:
        meetingReportsState.status === "loading"
          ? "0%"
          : getCappedProgressPercent(
              meetingReportsState.todayCount,
              homeMeetingReportListLimit
            ),
      tone: "meetingReports"
    }
  ] satisfies SummaryMetricItem[];
}

type SummaryMetricTone =
  | "calendar"
  | "issues"
  | "meetingReports"
  | "pullRequests";

type SummaryMetricItem = {
  background: ReactNode;
  className?: string;
  icon: ReactNode;
  label: string;
  progress: string;
  tone: SummaryMetricTone;
  value: string;
};

function SummaryMetricCard({
  item,
  variant = "default"
}: {
  item: SummaryMetricItem;
  variant?: "compact" | "default";
}) {
  const tone = getSummaryMetricTone(item.tone);

  if (variant === "compact") {
    return (
      <Card
        className={`relative min-h-0 overflow-hidden shadow-sm ${tone.borderClassName} ${tone.surfaceClassName} ${item.className ?? ""}`}
        size="sm"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {item.background}
        </div>
        <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col justify-between gap-1.5">
          <div className="flex min-h-0 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background/90 text-muted-foreground backdrop-blur ${tone.iconBorderClassName}`}
              >
                {item.icon}
              </span>
              <p
                className={`min-w-0 truncate text-sm font-semibold ${tone.labelClassName}`}
              >
                {item.label}
              </p>
            </div>
            <div className="flex shrink-0 items-baseline gap-1 text-right">
              <span
                className={`text-3xl font-semibold leading-none ${tone.valueClassName}`}
              >
                {item.value}
              </span>
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none ${tone.unitClassName}`}
              >
                개
              </span>
            </div>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-950/5">
            <div
              className={`h-full rounded-full ${tone.progressClassName}`}
              style={{ width: item.progress }}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`relative min-h-0 overflow-hidden shadow-sm ${tone.borderClassName} ${tone.surfaceClassName} ${item.className ?? ""}`}
      size="sm"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {item.background}
      </div>
      <CardContent className="relative z-10 flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg border bg-background/90 text-muted-foreground backdrop-blur ${tone.iconBorderClassName}`}
          >
            {item.icon}
          </span>
          <p className={`min-w-0 truncate text-sm font-semibold ${tone.labelClassName}`}>
            {item.label}
          </p>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-end">
          <div className="flex items-baseline gap-1 text-right">
            <span className={`text-4xl font-semibold leading-none ${tone.valueClassName}`}>
              {item.value}
            </span>
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] font-medium leading-none ${tone.unitClassName}`}
            >
              개
            </span>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-950/5">
          <div
            className={`h-full rounded-full ${tone.progressClassName}`}
            style={{ width: item.progress }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function getSummaryMetricTone(tone: SummaryMetricTone) {
  return {
    calendar: {
      borderClassName: "border-[#B7DCD7]",
      iconBorderClassName: "border-[#B7DCD7]",
      progressClassName: "bg-[#2EC4B6]",
      surfaceClassName: "bg-[#F4FBFA]",
      labelClassName: "text-[#0F766E]",
      unitClassName: "border-[#B7DCD7] bg-[#2EC4B6]/10 text-[#0F766E]",
      valueClassName: "text-[#134E4A]"
    },
    issues: {
      borderClassName: "border-[#D8D1FF]",
      iconBorderClassName: "border-[#D8D1FF]",
      progressClassName: "bg-[#9986F4]",
      surfaceClassName: "bg-[#F7F5FF]",
      labelClassName: "text-[#5B4BC4]",
      unitClassName: "border-[#D8D1FF] bg-[#9986F4]/10 text-[#5B4BC4]",
      valueClassName: "text-[#372A8C]"
    },
    meetingReports: {
      borderClassName: "border-[#CBEFBD]",
      iconBorderClassName: "border-[#CBEFBD]",
      progressClassName: "bg-[#2DB400]",
      surfaceClassName: "bg-[#F5FCF2]",
      labelClassName: "text-[#1F7A00]",
      unitClassName: "border-[#CBEFBD] bg-[#2DB400]/10 text-[#1F7A00]",
      valueClassName: "text-[#174F00]"
    },
    pullRequests: {
      borderClassName: "border-[#C8CCF2]",
      iconBorderClassName: "border-[#C8CCF2]",
      progressClassName: "bg-[#000080]",
      surfaceClassName: "bg-[#F5F6FF]",
      labelClassName: "text-[#000080]",
      unitClassName: "border-[#C8CCF2] bg-[#000080]/10 text-[#000080]",
      valueClassName: "text-[#00004D]"
    }
  }[tone];
}
