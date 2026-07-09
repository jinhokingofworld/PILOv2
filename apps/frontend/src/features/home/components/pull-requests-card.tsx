"use client";

import { useRouter } from "next/navigation";
import { GitPullRequest } from "lucide-react";

import type { GithubPullRequest } from "@/features/github-integration/types";
import {
  homePullRequestListLimit,
  type HomePullRequestsState
} from "../hooks/use-home-dashboard-data";
import {
  DashboardCard,
  DashboardCardMessage,
  DashboardNavigationAction,
  StatusPill
} from "./dashboard-card";
import { PullRequestsBackground } from "./home-backgrounds";

export function PullRequestsCard({
  pullRequestsState
}: {
  pullRequestsState: HomePullRequestsState;
}) {
  const visiblePullRequests = pullRequestsState.pullRequests.slice(
    0,
    homePullRequestListLimit
  );
  const isLoading = pullRequestsState.status === "loading";

  return (
    <DashboardCard
      action={
        <DashboardNavigationAction ariaLabel="PR 리뷰로 이동" href="/pr-review" />
      }
      background={<PullRequestsBackground />}
      className="border-[#C8CCF2] bg-[#F5F6FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)]"
      description={null}
      icon={<GitPullRequest className="size-4" />}
      title="PR"
      titleClassName="text-[#000080]"
    >
      <div className="grid min-h-0 flex-1 grid-rows-[repeat(3,minmax(0,1fr))] gap-2 overflow-hidden">
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
      aria-label={`${pullRequest.title} PR 리뷰로 이동`}
      className="flex min-h-0 min-w-0 flex-col justify-center overflow-hidden rounded-lg border bg-background/90 p-3 text-left shadow-sm backdrop-blur transition hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={handleOpenPullRequest}
      type="button"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {pullRequest.title}
        </p>
        <StatusPill
          label={pullRequest.draft ? "Draft" : `#${pullRequest.githubNumber}`}
          tone={pullRequest.draft ? "muted" : "neutral"}
        />
      </div>
      <p className="mt-1 min-w-0 truncate text-xs text-muted-foreground">
        {pullRequest.headBranch} → {pullRequest.baseBranch} ·{" "}
        {pullRequest.changedFilesCount} files
      </p>
    </button>
  );
}
