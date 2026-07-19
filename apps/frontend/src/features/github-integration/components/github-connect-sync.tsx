import { Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
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
  getGithubSyncProgressStageLabel,
  isGithubSyncActiveStatus
} from "@/features/github-integration/utils/github-sync-progress";

import {
  GithubConnectEmptyState,
  GithubConnectPanel,
  GithubConnectPill,
  GithubConnectProgress
} from "./github-connect-primitives";

const syncTargetOptions: Array<{ value: GithubSyncTarget; label: string }> = [
  { value: "source", label: "소스" },
  { value: "full", label: "전체" },
  { value: "repositories", label: "저장소" },
  { value: "issues", label: "Issue" },
  { value: "pull_requests", label: "Pull Request" },
  { value: "project_v2", label: "ProjectV2" },
  { value: "project_v2_fields", label: "ProjectV2 필드" },
  { value: "project_v2_items", label: "ProjectV2 아이템" }
];

const projectScopedSyncTargets = new Set<GithubSyncTarget>([
  "project_v2",
  "project_v2_fields",
  "project_v2_items"
]);

type GithubConnectSyncProps = {
  isLoading: boolean;
  installations: GithubAppInstallation[];
  selectedInstallationId: string;
  selectedProjectV2Id: string;
  selectedRepositoryId: string;
  syncRuns: GithubSyncRun[];
  syncRunsTotal: number;
  syncTarget: GithubSyncTarget;
  isSyncing: boolean;
  onSyncTargetChange: (target: GithubSyncTarget) => void;
  onStartSync: () => void;
};

export function GithubConnectSync({
  isLoading,
  installations,
  selectedInstallationId,
  selectedProjectV2Id,
  selectedRepositoryId,
  syncRuns,
  syncRunsTotal,
  syncTarget,
  isSyncing,
  onSyncTargetChange,
  onStartSync
}: GithubConnectSyncProps) {
  const isProjectTargetMissingSelection =
    projectScopedSyncTargets.has(syncTarget) && !selectedProjectV2Id;

  return (
    <>
      <GithubConnectPanel
        icon={<Play className="size-4" />}
        subtitle="선택한 installation 기준으로 백엔드 동기화 작업을 요청합니다."
        title="동기화 대상"
      >
        <div className="flex flex-col gap-3 @[48rem]:flex-row @[48rem]:items-end">
          <div className="min-w-0 flex-1">
            <span
              className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
              id="github-sync-target-label"
            >
              Target
            </span>
            <Select
              onValueChange={(value) => {
                if (value) onSyncTargetChange(value as GithubSyncTarget);
              }}
              value={syncTarget}
            >
              <SelectTrigger
                aria-labelledby="github-sync-target-label"
                className="mt-2 h-10 w-full"
              >
                <SelectValue>
                  {syncTargetOptions.find((option) => option.value === syncTarget)
                    ?.label ?? "대상 선택"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {syncTargetOptions.map((option) => (
                  <SelectItem
                    disabled={
                      (!selectedRepositoryId && option.value !== "source") ||
                      (projectScopedSyncTargets.has(option.value) && !selectedProjectV2Id)
                    }
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="h-10 rounded-[8px] bg-[#3157d5] text-white hover:bg-[#2447bd]"
            disabled={
              !selectedInstallationId ||
              isSyncing ||
              isLoading ||
              (!selectedRepositoryId && syncTarget !== "source") ||
              isProjectTargetMissingSelection
            }
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
        {isProjectTargetMissingSelection ? (
          <p className="mt-2 text-[12px] text-amber-700">
            Project v2를 먼저 선택해 주세요.
          </p>
        ) : null}
      </GithubConnectPanel>

      <GithubConnectPanel
        collapsible
        subtitle={`${formatGithubConnectNumber(syncRunsTotal)}개 수동 동기화 기록`}
        title="최근 수동 실행"
      >
        {isLoading ? (
          <LoadingStack rows={3} />
        ) : syncRuns.length === 0 ? (
          <GithubConnectEmptyState>
            아직 수동 동기화 기록이 없습니다. 대상을 선택한 뒤 첫 동기화를 시작할 수 있습니다.
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
                          : isGithubSyncActiveStatus(syncRun.status)
                            ? "info"
                            : "danger"
                      }
                    >
                      {getGithubConnectSyncStatusLabel(syncRun.status)}
                    </GithubConnectPill>
                  </div>
                  {isGithubSyncActiveStatus(syncRun.status) ? (
                    <>
                      <div className="mt-3">
                        <GithubConnectProgress value={progress} />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-[#7a8497]">
                        <span>{getGithubSyncProgressStageLabel(syncRun.progressStage)}</span>
                        <span className="font-semibold text-[#3157d5]">{progress}%</span>
                      </div>
                    </>
                  ) : null}
                  <p className="mt-2 text-[12px] text-[#7a8497]">
                    조회 {syncRun.fetchedCount} · 추가 {syncRun.createdCount} · 업데이트{" "}
                    {syncRun.updatedCount}
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
    </>
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
