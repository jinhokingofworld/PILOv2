type GithubManualSyncCompletion =
  | "success"
  | "transport_failure"
  | "rate_limited"
  | "definitive_failure";

type GithubManualSyncError = {
  status?: number;
  retryAfterSeconds?: number;
  message?: string;
};

function isGithubManualSyncError(value: unknown): value is GithubManualSyncError {
  return typeof value === "object" && value !== null;
}

function getRetryAfterSeconds(error: GithubManualSyncError): number {
  return error.retryAfterSeconds ?? 30;
}

export function getGithubManualSyncCompletion(error: unknown): GithubManualSyncCompletion {
  if (!isGithubManualSyncError(error) || error.status === undefined) {
    return "transport_failure";
  }

  return error.status === 429 ? "rate_limited" : "definitive_failure";
}

export function getGithubManualSyncErrorMessage(error: unknown): string {
  if (isGithubManualSyncError(error) && error.status === 429) {
    return `동기화 요청이 일시적으로 제한되었습니다. ${getRetryAfterSeconds(error)}초 후 다시 시도할 수 있습니다.`;
  }

  if (isGithubManualSyncError(error) && error.status === 503) {
    return `동기화 대기열이 포화 상태입니다. ${getRetryAfterSeconds(error)}초 후 다시 시도해 주세요.`;
  }

  if (error instanceof Error) return error.message;
  if (isGithubManualSyncError(error) && error.message) return error.message;

  return "GitHub 동기화 정보를 불러오지 못했습니다.";
}
