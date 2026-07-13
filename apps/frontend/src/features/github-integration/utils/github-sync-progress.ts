import type {
  GithubSyncProgressStage,
  GithubSyncRun,
  GithubSyncStatus
} from "@/features/github-integration/types";

type GithubSyncProgressLike = {
  status: GithubSyncStatus;
  progressPercent?: number;
  progressStage?: GithubSyncProgressStage;
};

type GithubSyncPollLoopOptions<TTimer> = {
  intervalMs: number;
  poll: () => Promise<boolean | null>;
  shouldContinue: (hasRunningSyncRun: boolean | null) => boolean;
  onError: (error: unknown) => void;
  schedule: (callback: () => void, delayMs: number) => TTimer;
  clear: (timer: TTimer) => void;
};

export const GITHUB_SYNC_POLL_INTERVAL_MS = 1500;

export function getGithubSyncProgress(syncRun: GithubSyncProgressLike) {
  if (syncRun.status === "success") {
    return 100;
  }

  const percent = syncRun.progressPercent;
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function isGithubSyncActiveStatus(status: GithubSyncStatus) {
  return status === "queued" || status === "running";
}

export function hasRunningGithubSyncRun(
  syncRuns: ReadonlyArray<Pick<GithubSyncRun, "status">>
) {
  return syncRuns.some((syncRun) => isGithubSyncActiveStatus(syncRun.status));
}

export function shouldPollGithubSyncRuns(
  isSyncing: boolean,
  hasRunningSyncRun: boolean
) {
  return isSyncing || hasRunningSyncRun;
}

export function createGithubSyncRequestGate() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(requestGeneration: number) {
      return requestGeneration === generation;
    },
    invalidate() {
      generation += 1;
    }
  };
}

export function createGithubSyncPollLoop<TTimer>({
  intervalMs,
  poll,
  shouldContinue,
  onError,
  schedule,
  clear
}: GithubSyncPollLoopOptions<TTimer>) {
  let stopped = false;
  let timer: TTimer | null = null;

  const scheduleNext = () => {
    if (stopped || timer !== null) {
      return;
    }

    timer = schedule(() => {
      timer = null;
      void pollOnce();
    }, intervalMs);
  };

  const pollOnce = async () => {
    try {
      const hasRunningSyncRun = await poll();
      if (!stopped && shouldContinue(hasRunningSyncRun)) {
        scheduleNext();
      }
    } catch (error) {
      if (!stopped) {
        onError(error);
        scheduleNext();
      }
    }
  };

  return {
    start: scheduleNext,
    stop() {
      stopped = true;
      if (timer !== null) {
        clear(timer);
        timer = null;
      }
    }
  };
}

export function getGithubSyncProgressStageLabel(
  stage: GithubSyncProgressStage | undefined
) {
  const labels: Record<GithubSyncProgressStage, string> = {
    initializing: "준비 중",
    repositories: "저장소 동기화",
    project_v2_discovery: "ProjectV2 탐색",
    issues: "Issue 동기화",
    pull_requests: "Pull Request 동기화",
    project_v2: "ProjectV2 동기화",
    project_v2_fields: "ProjectV2 필드 동기화",
    project_v2_items: "ProjectV2 아이템 동기화",
    board_hydration: "Board 갱신",
    finalizing: "마무리 중",
    completed: "완료"
  };

  return stage ? labels[stage] : labels.initializing;
}
