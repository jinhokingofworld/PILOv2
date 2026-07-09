"use client";

import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import {
  homeMeetingReportListLimit,
  type HomeMeetingReportsState
} from "../hooks/use-home-dashboard-data";
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
import { MeetingReportsBackground } from "./home-backgrounds";

export function MeetingReportsCard({
  meetingReportsState
}: {
  meetingReportsState: HomeMeetingReportsState;
}) {
  const router = useRouter();
  const visibleMeetingReports = meetingReportsState.reports.slice(
    0,
    homeMeetingReportListLimit
  );
  const isLoading = meetingReportsState.status === "loading";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction
          ariaLabel="회의록으로 이동"
          href="/meeting#report"
        />
      }
      background={<MeetingReportsBackground />}
      className="border-[#CBEFBD] bg-[#F5FCF2] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
      description={null}
      icon={<FileText className="size-4" />}
      title="회의록"
      titleClassName="text-[#1F7A00]"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(4,minmax(0,1fr))] gap-2 overflow-hidden">
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
              key={report.id}
              aria-label={`${formatMeetingReportTitle(report)} 회의록으로 이동`}
              className="flex min-h-0 flex-col justify-center overflow-hidden rounded-lg border bg-background/90 p-2.5 text-left shadow-sm backdrop-blur transition hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={() => router.push(buildMeetingReportHref(report.id))}
              type="button"
            >
              <p className="min-w-0 truncate text-sm font-medium leading-5">
                {formatMeetingReportTitle(report)}
              </p>
              <p className="mt-0.5 min-w-0 truncate text-xs leading-4 text-muted-foreground">
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
