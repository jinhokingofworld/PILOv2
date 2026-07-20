"use client";

import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";

import type { BoardIssueCardPayload } from "@/features/board/types";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";
import type { HomeIssuesState } from "../hooks/use-home-dashboard-data";
import {
  DashboardCard,
  DashboardCardMessage,
  DashboardNavigationAction,
  StatusPill
} from "./dashboard-card";

export function IssuesCard({ issuesState }: { issuesState: HomeIssuesState }) {
  const visibleTodoIssues = issuesState.issues.slice(0, 3);
  const isLoading = issuesState.status === "loading";
  const isRecentMode = issuesState.mode === "recent";
  const issueDescription = isLoading
    ? "이슈를 불러오는 중입니다"
    : issuesState.status === "error"
      ? "이슈 상태를 확인할 수 없습니다"
      : `${issuesState.total}개의 open 이슈`;

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction ariaLabel="이슈로 이동" href="/board#issues" />
      }
      className="min-h-[280px]"
      cursorTarget={{ id: "issues", label: "이슈", type: "home_card" }}
      description={issueDescription}
      icon={<ListChecks className="size-4" />}
      title={isRecentMode ? "최근 이슈" : "내 이슈"}
      titleAdornment={
        isRecentMode ? (
          <span className="min-w-0 truncate text-[12px] font-medium text-destructive">
            GitHub 연결 시 내 담당 이슈만 볼 수 있어요
          </span>
        ) : null
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
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
      {...pageCursorTargetAttributes({
        id: issue.id,
        label: issue.title,
        type: "home_issue"
      })}
      aria-label={`${issue.title} 이슈로 이동`}
      className="flex min-h-[54px] min-w-0 items-center overflow-hidden rounded-[10px] border border-[#eceef2] bg-[#fbfbfc] px-3 py-2.5 text-left transition hover:border-[#dfe2e8] hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => router.push(boardIssueHref)}
      type="button"
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#202124]">
          {issue.title}
        </p>
        <StatusPill label={issue.issueNumber} tone="neutral" />
      </div>
    </button>
  );
}
