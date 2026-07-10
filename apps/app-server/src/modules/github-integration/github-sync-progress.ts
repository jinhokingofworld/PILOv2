import type {
  GithubSyncProgressStage,
  GithubSyncStatus
} from "./types";

const GITHUB_SYNC_PROGRESS_STAGES: readonly GithubSyncProgressStage[] = [
  "initializing",
  "repositories",
  "project_v2_discovery",
  "issues",
  "pull_requests",
  "project_v2",
  "project_v2_fields",
  "project_v2_items",
  "board_hydration",
  "finalizing",
  "completed"
];

interface GithubSyncProgressCursor {
  percent: number;
  stage: GithubSyncProgressStage;
}

const GITHUB_FULL_SYNC_PROJECT_PROGRESS_START = 65;
const GITHUB_FULL_SYNC_PROJECT_PROGRESS_RANGE = 30;

export function readGithubSyncProgress(
  status: GithubSyncStatus,
  cursor: unknown
): {
  progressPercent: number;
  progressStage: GithubSyncProgressStage;
} {
  if (status === "success") {
    return {
      progressPercent: 100,
      progressStage: "completed"
    };
  }

  const progress = readProgressCursor(cursor);
  return progress
    ? {
        progressPercent: progress.percent,
        progressStage: progress.stage
      }
    : {
        progressPercent: 0,
        progressStage: "initializing"
      };
}

export function createGithubSyncProgressCursor(
  percent: number,
  stage: GithubSyncProgressStage
): GithubSyncProgressCursor {
  return {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    stage
  };
}

export function getGithubFullSyncProjectProgressPercent(
  completedSteps: number,
  totalSteps: number
): number {
  if (totalSteps <= 0) {
    return 95;
  }

  const boundedCompletedSteps = Math.max(
    0,
    Math.min(totalSteps, completedSteps)
  );
  return (
    GITHUB_FULL_SYNC_PROJECT_PROGRESS_START +
    Math.round(
      (boundedCompletedSteps / totalSteps) *
        GITHUB_FULL_SYNC_PROJECT_PROGRESS_RANGE
    )
  );
}

function readProgressCursor(value: unknown): GithubSyncProgressCursor | null {
  const cursor = toRecord(value);
  const progress = toRecord(cursor?.progress);
  if (!progress) {
    return null;
  }

  const percent = progress.percent;
  const stage = progress.stage;
  if (
    typeof percent !== "number" ||
    !Number.isInteger(percent) ||
    percent < 0 ||
    percent > 100 ||
    typeof stage !== "string" ||
    !GITHUB_SYNC_PROGRESS_STAGES.includes(stage as GithubSyncProgressStage)
  ) {
    return null;
  }

  return {
    percent,
    stage: stage as GithubSyncProgressStage
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return toRecord(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}
