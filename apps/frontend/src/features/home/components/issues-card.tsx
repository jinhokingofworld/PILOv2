"use client";

import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";

import type { BoardIssueCardPayload } from "@/features/board/types";
import {
  homeIssueListLimit,
  type HomeIssuesState
} from "../hooks/use-home-dashboard-data";
import {
  DashboardCard,
  DashboardCardMessage,
  DashboardNavigationAction,
  StatusPill
} from "./dashboard-card";
import { IssuesBackground } from "./home-backgrounds";

export function IssuesCard({ issuesState }: { issuesState: HomeIssuesState }) {
  const visibleTodoIssues = issuesState.issues.slice(0, homeIssueListLimit);
  const isLoading = issuesState.status === "loading";
  const isRecentMode = issuesState.mode === "recent";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction ariaLabel="이슈로 이동" href="/board#issues" />
      }
      background={<IssuesBackground />}
      className="border-[#D8D1FF] bg-[#F7F5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
      description={null}
      icon={<ListChecks className="size-4" />}
      title={isRecentMode ? "최근 이슈" : "내 이슈"}
      titleAdornment={
        isRecentMode ? (
          <span className="min-w-0 truncate text-[0.7rem] font-medium text-destructive">
            GitHub 연결 시 내 담당 이슈만 볼 수 있어요
          </span>
        ) : null
      }
      titleClassName="text-[#5B4BC4]"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(5,minmax(0,1fr))] gap-2 overflow-hidden">
        {isLoading ? (
          <DashboardCardMessage>이슈 불러오는 중</DashboardCardMessage>
        ) : issuesState.status === "error" ? (
          <DashboardCardMessage tone="danger">
            이슈를 불러오지 못했습니다
          </DashboardCardMessage>
        ) : visibleTodoIssues.length > 0 ? (
          visibleTodoIssues.map((issue) => (
            <IssueTodoRow key={issue.id} issue={issue} />
          ))
        ) : (
          <DashboardCardMessage>표시할 open 이슈가 없습니다</DashboardCardMessage>
        )}
      </div>
    </DashboardCard>
  );
}

function IssueTodoRow({ issue }: { issue: BoardIssueCardPayload }) {
  const router = useRouter();
  const boardIssueHref = `/board?boardId=${encodeURIComponent(
    issue.boardId
  )}&issueId=${encodeURIComponent(issue.id)}#issues`;

  return (
    <button
      aria-label={`${issue.title} 이슈로 이동`}
      className="flex min-h-0 min-w-0 items-center overflow-hidden rounded-lg border bg-background/90 p-3 text-left shadow-sm backdrop-blur transition hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => router.push(boardIssueHref)}
      type="button"
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {issue.title}
        </p>
        <StatusPill label={issue.issueNumber} tone="neutral" />
      </div>
    </button>
  );
}
