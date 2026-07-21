"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  HomeIssuesState,
  HomeMeetingReportsState,
  HomePullRequestsState
} from "../hooks/use-home-dashboard-data";
import { IssuesCard } from "./issues-card";
import { MeetingReportsCard } from "./meeting-reports-card";
import { PullRequestsCard } from "./pull-requests-card";

export function MiddleDashboardCards({
  issuesState,
  meetingReportsState,
  pullRequestsState
}: {
  issuesState: HomeIssuesState;
  meetingReportsState: HomeMeetingReportsState;
  pullRequestsState: HomePullRequestsState;
}) {
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const dashboardCards = [
    <IssuesCard issuesState={issuesState} key="issues" />,
    <PullRequestsCard pullRequestsState={pullRequestsState} key="pull-requests" />,
    <MeetingReportsCard meetingReportsState={meetingReportsState} key="meeting-reports" />
  ];

  return (
    <>
      <div className="grid min-h-0 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2 sm:hidden">
        {activeCardIndex > 0 ? (
          <Button
            aria-label="이전 카드로 이동"
            onClick={() => setActiveCardIndex((currentIndex) => currentIndex - 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft />
          </Button>
        ) : (
          <span aria-hidden="true" className="size-8" />
        )}
        <div className="min-w-0">{dashboardCards[activeCardIndex]}</div>
        {activeCardIndex < dashboardCards.length - 1 ? (
          <Button
            aria-label="다음 카드로 이동"
            onClick={() => setActiveCardIndex((currentIndex) => currentIndex + 1)}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronRight />
          </Button>
        ) : (
          <span aria-hidden="true" className="size-8" />
        )}
      </div>
      <div className="hidden min-h-0 sm:grid sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        <IssuesCard issuesState={issuesState} />
        <PullRequestsCard pullRequestsState={pullRequestsState} />
        <div className="min-h-0 sm:col-span-2 xl:col-span-1">
          <MeetingReportsCard meetingReportsState={meetingReportsState} />
        </div>
      </div>
    </>
  );
}
