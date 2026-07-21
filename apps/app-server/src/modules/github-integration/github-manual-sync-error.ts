import { HttpException, HttpStatus } from "@nestjs/common";

type GithubManualSyncLimitScope = "user" | "workspace";

class GithubManualSyncAdmissionError extends HttpException {
  constructor(status: HttpStatus, error: Record<string, unknown>) {
    super({ success: false, error }, status);
  }
}

export class GithubManualSyncIdempotencyConflictError extends GithubManualSyncAdmissionError {
  constructor() {
    super(HttpStatus.CONFLICT, {
      code: "GITHUB_SYNC_IDEMPOTENCY_CONFLICT",
      message: "GitHub manual sync idempotency key conflicts with a different request"
    });
  }
}

export class GithubManualSyncRateLimitedError extends GithubManualSyncAdmissionError {
  constructor(limitScope: GithubManualSyncLimitScope, retryAfterSeconds: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, {
      code: "GITHUB_SYNC_RATE_LIMITED",
      message: "GitHub manual sync is temporarily rate limited",
      details: { limitScope, retryAfterSeconds }
    });
  }
}

export class GithubManualSyncQueueSaturatedError extends GithubManualSyncAdmissionError {
  constructor(retryAfterSeconds: number) {
    super(HttpStatus.SERVICE_UNAVAILABLE, {
      code: "GITHUB_SYNC_QUEUE_SATURATED",
      message: "GitHub manual sync queue is saturated",
      details: { retryAfterSeconds }
    });
  }
}
