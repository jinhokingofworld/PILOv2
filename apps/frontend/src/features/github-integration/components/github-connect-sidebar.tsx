import { GitPullRequest, Loader2, Play, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  GithubAppInstallation,
  GithubPullRequest,
  GithubRepository,
  GithubSyncRun,
  GithubSyncTarget
} from "@/features/github-integration/types";
import {
  formatGithubConnectDateTime,
  formatGithubConnectNumber,
  getGithubConnectSyncProgress,
  getGithubConnectSyncStatusLabel,
  getGithubConnectSyncTargetLabel
} from "@/features/github-integration/utils/github-connect-format";

import {
  GithubConnectEmptyState,
  GithubConnectPanel,
  GithubConnectPill,
  GithubConnectProgress
} from "./github-connect-primitives";

const syncTargetOptions: Array<{
  value: GithubSyncTarget;
  label: string;
}> = [
  { value: "full", label: "전체" },
  { value: "repositories", label: "저장소" },
  { value: "issues", label: "Issue" },
  { value: "pull_requests", label: "Pull Request" },
  { value: "project_v2", label: "ProjectV2" },
  { value: "project_v2_fields", label: "ProjectV2 필드" },
  { value: "project_v2_items", label: "ProjectV2 아이템" }
];

type SidebarProps = {
  connected: boolean;
  isLoading: boolean;
  installations: GithubAppInstallation[];
  selectedInstallationId: string;
  selectedInstallation: GithubAppInstallation | undefined;
  repositoriesTotal: number;
  projectsTotal: number;
  selectedRepository: GithubRepository | undefined;
  pullRequests: GithubPullRequest[];
  pullRequestsTotal: number;
  isPullRequestsLoading: boolean;
  syncRuns: GithubSyncRun[];
  syncRunsTotal: number;
  syncTarget: GithubSyncTarget;
  isSyncing: boolean;
  onSelectInstallation: (id: string) => void;
  onSyncTargetChange: (target: GithubSyncTarget) => void;
  onStartSync: () => void;
  onRefresh: () => void;
};

export function GithubConnectSidebar({
  connected,
  isLoading,
  installations,
  selectedInstallationId,
  selectedInstallation,
  repositoriesTotal,
  projectsTotal,
  selectedRepository,
  pullRequests,
  pullRequestsTotal,
  isPullRequestsLoading,
  syncRuns,
  syncRunsTotal,
  syncTarget,
  isSyncing,
  onSelectInstallation,
  onSyncTargetChange,
  onStartSync,
  onRefresh
}: SidebarProps) {
  return (
    <aside className="space-y-[15px]">
      <GithubConnectPanel
        action={
          <Button
            className="h-8 rounded-[8px]"
            disabled={isLoading}
            onClick={onRefresh}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCcw data-icon="inline-start" />
            새로고침
          </Button>
        }
        title="현재 상태"
        subtitle="연결 준비부터 데이터 동기화까지 필요한 상태를 압축해서 보여줍니다."
      >
        <div className="health-list space-y-3">
          <HealthRow
            detail={
              connected
                ? "OAuth 토큰으로 API 요청 가능"
                : "GitHub OAuth 연결 필요"
            }
            label="GitHub App"
            tone={connected ? "success" : "warning"}
            value={connected ? "Ready" : "Wait"}
          />
          <HealthRow
            detail={`${formatGithubConnectNumber(repositoriesTotal)}개 저장소`}
            label="허용 저장소"
            tone={repositoriesTotal > 0 ? "success" : "warning"}
            value={repositoriesTotal > 0 ? "Synced" : "Empty"}
          />
          <HealthRow
            detail={`${formatGithubConnectNumber(projectsTotal)}개 Project`}
            label="Projects v2"
            tone={projectsTotal > 0 ? "success" : "warning"}
            value={projectsTotal > 0 ? "Synced" : "Empty"}
          />
        </div>

        <div className="mt-4 rounded-[8px] border border-[#e5e9f2] bg-[#fbfcfe] p-3">
          <label className="block text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
            Installation
          </label>
          <select
            className="mt-2 h-10 w-full rounded-[8px] border border-[#d9dee8] bg-white px-3 text-[13px] text-[#293142] outline-none transition-colors focus:border-[#3157d5]"
            disabled={installations.length === 0 || isLoading}
            onChange={(event) => onSelectInstallation(event.target.value)}
            value={selectedInstallationId}
          >
            {installations.length === 0 ? (
              <option value="">설치 없음</option>
            ) : null}
            {installations.map((installation) => (
              <option key={installation.id} value={installation.id}>
                {installation.accountLogin} · #{installation.githubInstallationId}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[12px] leading-5 text-[#7a8497]">
            {selectedInstallation
              ? `${selectedInstallation.accountType} · ${
                  selectedInstallation.repositorySelection ?? "선택 범위 없음"
                }`
              : "OAuth 연결 후 GitHub App을 설치하세요."}
          </p>
        </div>
      </GithubConnectPanel>

      <GithubConnectPanel
        icon={<Play className="size-4" />}
        title="동기화 실행"
        subtitle="선택한 installation 기준으로 백엔드 동기화 작업을 요청합니다."
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a8497]">
              Target
            </span>
            <select
              className="mt-2 h-10 w-full rounded-[8px] border border-[#d9dee8] bg-white px-3 text-[13px] text-[#293142] outline-none transition-colors focus:border-[#3157d5]"
              onChange={(event) =>
                onSyncTargetChange(event.target.value as GithubSyncTarget)
              }
              value={syncTarget}
            >
              {syncTargetOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Button
            className="h-10 w-full rounded-[8px] bg-[#3157d5] text-white hover:bg-[#2447bd]"
            disabled={!selectedInstallationId || isSyncing || isLoading}
            onClick={onStartSync}
            type="button"
          >
            {isSyncing ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            동기화 시작
          </Button>
        </div>
      </GithubConnectPanel>

      <GithubConnectPanel
        title="최근 작업"
        subtitle={`${formatGithubConnectNumber(syncRunsTotal)}개 sync run 기록`}
      >
        {isLoading ? (
          <LoadingStack rows={3} />
        ) : syncRuns.length === 0 ? (
          <GithubConnectEmptyState>
            아직 실행된 GitHub 동기화 작업이 없습니다.
          </GithubConnectEmptyState>
        ) : (
          <div className="job-list space-y-3">
            {syncRuns.map((syncRun) => (
              <div
                className="rounded-[8px] border border-[#e5e9f2] bg-[#fbfcfe] p-3"
                key={syncRun.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-[#101828]">
                      {getGithubConnectSyncTargetLabel(syncRun.target)}
                    </p>
                    <p className="mt-1 text-[12px] text-[#7a8497]">
                      {formatGithubConnectDateTime(syncRun.startedAt)}
                    </p>
                  </div>
                  <GithubConnectPill
                    tone={
                      syncRun.status === "success"
                        ? "success"
                        : syncRun.status === "running"
                          ? "info"
                          : "danger"
                    }
                  >
                    {getGithubConnectSyncStatusLabel(syncRun.status)}
                  </GithubConnectPill>
                </div>
                <div className="mt-3">
                  <GithubConnectProgress
                    value={getGithubConnectSyncProgress(syncRun)}
                  />
                </div>
                <p className="mt-2 text-[12px] text-[#7a8497]">
                  fetched {syncRun.fetchedCount} · created{" "}
                  {syncRun.createdCount} · updated {syncRun.updatedCount}
                </p>
                {syncRun.errorMessage ? (
                  <p className="mt-2 text-[12px] leading-5 text-[#b42318]">
                    {syncRun.errorMessage}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </GithubConnectPanel>

      <GithubConnectPanel
        icon={<GitPullRequest className="size-4" />}
        title="Pull Requests"
        subtitle={
          selectedRepository
            ? `${selectedRepository.fullName} · ${formatGithubConnectNumber(
                pullRequestsTotal
              )}개`
            : "저장소를 선택하면 PR 목록을 조회합니다."
        }
      >
        {isPullRequestsLoading ? (
          <LoadingStack rows={3} />
        ) : pullRequests.length === 0 ? (
          <GithubConnectEmptyState>
            선택한 저장소의 Pull Request가 없거나 아직 동기화되지 않았습니다.
          </GithubConnectEmptyState>
        ) : (
          <div className="space-y-2">
            {pullRequests.map((pullRequest) => (
              <a
                className="block rounded-[8px] border border-[#e5e9f2] bg-[#fbfcfe] p-3 transition-colors hover:border-[#c7d2fe] hover:bg-[#f5f7ff]"
                href={pullRequest.githubUrl}
                key={pullRequest.id}
                rel="noreferrer"
                target="_blank"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-[13px] font-semibold leading-5 text-[#101828]">
                    #{pullRequest.githubNumber} {pullRequest.title}
                  </p>
                  <GithubConnectPill
                    tone={pullRequest.state === "open" ? "success" : "default"}
                  >
                    {pullRequest.state}
                  </GithubConnectPill>
                </div>
                <p className="mt-2 text-[12px] text-[#7a8497]">
                  {pullRequest.headBranch ?? "-"} →{" "}
                  {pullRequest.baseBranch ?? "-"} · {pullRequest.changedFilesCount}
                  files
                </p>
              </a>
            ))}
          </div>
        )}
      </GithubConnectPanel>
    </aside>
  );
}

function HealthRow({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "danger";
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[8px] border border-[#e5e9f2] bg-[#fbfcfe] p-3">
      <div>
        <p className="text-[13px] font-semibold text-[#101828]">{label}</p>
        <p className="mt-1 text-[12px] leading-5 text-[#7a8497]">{detail}</p>
      </div>
      <GithubConnectPill tone={tone}>{value}</GithubConnectPill>
    </div>
  );
}

function LoadingStack({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton className="h-16 rounded-[8px]" key={index} />
      ))}
    </div>
  );
}
