import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  GithubAppInstallation,
  GithubSyncRun,
  GithubSyncTarget
} from "@/features/github-integration/types";
import {
  formatGithubConnectDateTime,
  formatGithubConnectNumber,
  getGithubConnectSyncStatusLabel,
  getGithubConnectSyncTargetLabel
} from "@/features/github-integration/utils/github-connect-format";
import {
  getGithubSyncProgress,
  getGithubSyncProgressStageLabel
} from "@/features/github-integration/utils/github-sync-progress";

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
  isLoading: boolean;
  installations: GithubAppInstallation[];
  selectedInstallationId: string;
  syncRuns: GithubSyncRun[];
  syncRunsTotal: number;
  syncTarget: GithubSyncTarget;
  isSyncing: boolean;
  onSyncTargetChange: (target: GithubSyncTarget) => void;
  onStartSync: () => void;
};

export function GithubConnectSidebar({
  isLoading,
  installations,
  selectedInstallationId,
  syncRuns,
  syncRunsTotal,
  syncTarget,
  isSyncing,
  onSyncTargetChange,
  onStartSync
}: SidebarProps) {
  return (
    <aside className="space-y-[15px]">
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
        collapsible
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
            {syncRuns.map((syncRun) => {
              const installation = syncRun.installationId
                ? installations.find((item) => item.id === syncRun.installationId)
                : null;
              const progress = getGithubSyncProgress(syncRun);

              return (
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
                    {installation ? (
                      <p className="mt-1 text-[12px] font-medium text-[#4b5565]">
                        Installation @{installation.accountLogin}
                      </p>
                    ) : null}
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
                  <GithubConnectProgress value={progress} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-[#7a8497]">
                  <span>{getGithubSyncProgressStageLabel(syncRun.progressStage)}</span>
                  <span className="font-semibold text-[#3157d5]">{progress}%</span>
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
              );
            })}
          </div>
        )}
      </GithubConnectPanel>

    </aside>
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
