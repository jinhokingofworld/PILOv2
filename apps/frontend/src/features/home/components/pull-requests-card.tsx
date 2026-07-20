"use client";

import { useRouter } from "next/navigation";
import { GitPullRequest } from "lucide-react";

import type { GithubPullRequest } from "@/features/github-integration/types";
import { pageCursorTargetAttributes } from "@/shared/page-cursor/page-cursor-target";
import type { HomePullRequestsState } from "../hooks/use-home-dashboard-data";
import {
  DashboardCard,
  DashboardCardMessage,
  DashboardNavigationAction,
  StatusPill
} from "./dashboard-card";

export function PullRequestsCard({
  pullRequestsState
}: {
  pullRequestsState: HomePullRequestsState;
}) {
  const visiblePullRequests = pullRequestsState.pullRequests.slice(0, 3);
  const isLoading = pullRequestsState.status === "loading";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction ariaLabel="PR 리뷰로 이동" href="/pr-review" />
      }
      className="min-h-[280px]"
      cursorTarget={{ id: "pull-requests", label: "PR", type: "home_card" }}
      description={null}
      icon={<GitPullRequest className="size-4" />}
      title="PR 리뷰"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        {isLoading ? (
          <DashboardCardMessage rowSpanClassName="row-span-3">
            PR 불러오는 중
          </DashboardCardMessage>
        ) : pullRequestsState.status === "error" ? (
          <DashboardCardMessage rowSpanClassName="row-span-3" tone="danger">
            PR을 불러오지 못했습니다
          </DashboardCardMessage>
        ) : visiblePullRequests.length > 0 ? (
          visiblePullRequests.map((pullRequest) => (
            <PullRequestRow key={pullRequest.id} pullRequest={pullRequest} />
          ))
        ) : (
          <DashboardCardMessage rowSpanClassName="row-span-3">
            표시할 open PR이 없습니다
          </DashboardCardMessage>
        )}
      </div>
    </DashboardCard>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: GithubPullRequest }) {
  const router = useRouter();

  const handleOpenPullRequest = () => {
    const searchParams = new URLSearchParams({
      pullRequestId: pullRequest.id,
      repositoryId: pullRequest.repositoryId
    });

    router.push(`/pr-review?${searchParams.toString()}`);
  };

  return (
    <button
      {...pageCursorTargetAttributes({
        id: pullRequest.id,
        label: pullRequest.title,
        type: "home_pull_request"
      })}
      aria-label={`${pullRequest.title} PR 리뷰로 이동`}
      className="flex min-h-[54px] min-w-0 flex-col justify-center overflow-hidden rounded-[10px] border border-[#eceef2] bg-[#fbfbfc] px-3 py-2.5 text-left transition hover:border-[#dfe2e8] hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={handleOpenPullRequest}
      type="button"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#202124]">
          {pullRequest.title}
        </p>
        <StatusPill
          label={pullRequest.draft ? "Draft" : `#${pullRequest.githubNumber}`}
          tone={pullRequest.draft ? "muted" : "neutral"}
        />
      </div>
      <p className="mt-1 min-w-0 truncate text-[13px] text-[#747882]">
        {pullRequest.headBranch} → {pullRequest.baseBranch} ·{" "}
        {pullRequest.changedFilesCount} files
      </p>
    </button>
  );
}
