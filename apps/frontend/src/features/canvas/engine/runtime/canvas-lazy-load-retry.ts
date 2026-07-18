const DEFAULT_CANVAS_LAZY_LOAD_MAX_ATTEMPTS = 5;
const DEFAULT_CANVAS_LAZY_LOAD_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_CANVAS_LAZY_LOAD_RETRY_MAX_DELAY_MS = 8_000;

type CanvasLazyLoadRetryOptions<T> = {
  load: (attempt: number) => Promise<T>;
  maxAttempts?: number;
  onRetry?: (input: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
  shouldContinue?: () => boolean;
  wait?: (delayMs: number) => Promise<void>;
};

function createCanvasLazyLoadAbortError() {
  const error = new Error("Canvas lazy load request is no longer active");

  error.name = "AbortError";
  return error;
}

function readErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }

  const status = error.status;

  return typeof status === "number" && Number.isFinite(status)
    ? status
    : null;
}

function waitForCanvasLazyLoadRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function isCanvasLazyLoadAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function shouldRetryCanvasLazyLoad(error: unknown) {
  if (isCanvasLazyLoadAbortError(error)) return false;

  const status = readErrorStatus(error);

  if (status === null) return true;
  if (status >= 200 && status < 300) return true;

  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function getCanvasLazyLoadRetryDelay(attempt: number) {
  return Math.min(
    DEFAULT_CANVAS_LAZY_LOAD_RETRY_BASE_DELAY_MS *
      2 ** Math.max(0, attempt - 1),
    DEFAULT_CANVAS_LAZY_LOAD_RETRY_MAX_DELAY_MS,
  );
}

export async function runCanvasLazyLoadWithRetry<T>({
  load,
  maxAttempts = DEFAULT_CANVAS_LAZY_LOAD_MAX_ATTEMPTS,
  onRetry,
  shouldContinue = () => true,
  wait = waitForCanvasLazyLoadRetry,
}: CanvasLazyLoadRetryOptions<T>) {
  const normalizedMaxAttempts = Math.max(1, Math.trunc(maxAttempts));

  for (let attempt = 1; attempt <= normalizedMaxAttempts; attempt += 1) {
    if (!shouldContinue()) {
      throw createCanvasLazyLoadAbortError();
    }

    try {
      return await load(attempt);
    } catch (error) {
      if (
        attempt >= normalizedMaxAttempts ||
        !shouldRetryCanvasLazyLoad(error)
      ) {
        throw error;
      }

      const delayMs = getCanvasLazyLoadRetryDelay(attempt);

      onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
    }
  }

  throw new Error("Canvas lazy load retry exhausted unexpectedly");
}
