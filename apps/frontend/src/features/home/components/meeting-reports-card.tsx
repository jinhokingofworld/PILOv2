"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import type { HomeMeetingReportsState } from "../hooks/use-home-dashboard-data";
import {
  formatMeetingReportTitle,
  getMeetingReportFallbackSummary
} from "../utils/home-format";
import { buildMeetingReportHref } from "../utils/home-routing";
import {
  DashboardCard,
  DashboardCardMessage,
  DashboardNavigationAction
} from "./dashboard-card";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";

export function MeetingReportsCard({
  meetingReportsState
}: {
  meetingReportsState: HomeMeetingReportsState;
}) {
  const router = useRouter();
  const visibleMeetingReports = meetingReportsState.reports.slice(0, 3);
  const isLoading = meetingReportsState.status === "loading";
  const meetingReportDescription = isLoading
    ? "회의록을 불러오는 중입니다"
    : meetingReportsState.status === "error"
      ? "회의록 상태를 확인할 수 없습니다"
      : `오늘 회의 ${meetingReportsState.todayCount}개`;

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction
          ariaLabel="회의록으로 이동"
          href="/report"
        />
      }
      className="min-h-[280px]"
      cursorTarget={{ id: "meeting-reports", label: "회의록", type: "home_card" }}
      description={meetingReportDescription}
      icon={<FileText className="size-4" />}
      title="최근 회의록"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {isLoading ? (
          <DashboardCardMessage rowSpanClassName="row-span-4">
            회의록 불러오는 중
          </DashboardCardMessage>
        ) : meetingReportsState.status === "error" ? (
          <DashboardCardMessage rowSpanClassName="row-span-4" tone="danger">
            회의록을 불러오지 못했습니다
          </DashboardCardMessage>
        ) : visibleMeetingReports.length > 0 ? (
          visibleMeetingReports.map((report) => (
            <button
              {...pageCursorTargetAttributes({
                id: report.id,
                label: formatMeetingReportTitle(report),
                type: "home_meeting_report"
              })}
              key={report.id}
              aria-label={`${formatMeetingReportTitle(report)} 회의록으로 이동`}
              className="flex min-h-[54px] flex-col justify-center overflow-hidden rounded-[10px] border border-border bg-muted/50 px-3 py-2.5 text-left transition hover:bg-muted hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => router.push(buildMeetingReportHref(report.id))}
              type="button"
            >
              <p className="min-w-0 truncate text-[17px] font-medium leading-5 text-foreground">
                {formatMeetingReportTitle(report)}
              </p>
              <p className="mt-0.5 min-w-0 truncate text-[16px] leading-4 text-muted-foreground">
                {report.summary?.trim() || getMeetingReportFallbackSummary(report)}
              </p>
            </button>
          ))
        ) : (
          <DashboardCardMessage rowSpanClassName="row-span-4">
            표시할 회의록이 없습니다
          </DashboardCardMessage>
        )}
      </div>
    </DashboardCard>
  );
}
