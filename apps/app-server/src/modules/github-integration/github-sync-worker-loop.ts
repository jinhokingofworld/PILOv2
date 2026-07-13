export type GithubSyncWorkerFailureKind =
  | "database_session_pool_exhausted"
  | "unknown";

export interface GithubSyncWorkerPoller {
  pollOnce(): Promise<void>;
}

export interface GithubSyncWorkerPollObserver {
  emitWorkerPollRetry(
    retryAfterMilliseconds: number,
    failureKind: GithubSyncWorkerFailureKind
  ): void;
}

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15_000;

export async function runGithubSyncWorkerLoop(
  worker: GithubSyncWorkerPoller,
  observer: GithubSyncWorkerPollObserver,
  isStopping: () => boolean,
  wait: (milliseconds: number) => Promise<void> = waitForRetry
): Promise<void> {
  let retryDelayMs = INITIAL_RETRY_DELAY_MS;

  while (!isStopping()) {
    try {
      await worker.pollOnce();
      retryDelayMs = INITIAL_RETRY_DELAY_MS;
    } catch (error) {
      observer.emitWorkerPollRetry(
        retryDelayMs,
        classifyGithubSyncWorkerFailure(error)
      );
      await wait(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }
  }
}

export function classifyGithubSyncWorkerFailure(
  error: unknown
): GithubSyncWorkerFailureKind {
  if (hasErrorCode(error, "EMAXCONNSESSION")) {
    return "database_session_pool_exhausted";
  }

  if (error instanceof Error && error.message.includes("EMAXCONNSESSION")) {
    return "database_session_pool_exhausted";
  }

  return "unknown";
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === expectedCode
  );
}

function waitForRetry(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
