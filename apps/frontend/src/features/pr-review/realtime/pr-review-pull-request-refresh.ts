"use client";

export type PrReviewPullRequestRefreshCoordinator = {
  dispose: () => void;
  refresh: () => Promise<void>;
};

export function createPrReviewPullRequestRefreshCoordinator<T>({
  apply,
  load,
  onError
}: {
  apply: (value: T) => void;
  load: () => Promise<T>;
  onError?: () => void;
}): PrReviewPullRequestRefreshCoordinator {
  let disposed = false;
  let generation = 0;
  let refreshInFlight: Promise<void> | null = null;
  let refreshPending = false;

  function refresh(): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    if (refreshInFlight) {
      refreshPending = true;
      return refreshInFlight;
    }

    const requestGeneration = generation;
    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        if (!disposed && requestGeneration === generation) {
          apply(value);
        }
      })
      .catch(() => {
        if (!disposed && requestGeneration === generation) {
          onError?.();
        }
      })
      .finally(() => {
        if (refreshInFlight !== request) {
          return;
        }
        refreshInFlight = null;
        if (refreshPending && !disposed) {
          refreshPending = false;
          void refresh();
        }
      });
    refreshInFlight = request;
    return request;
  }

  return {
    dispose() {
      disposed = true;
      generation += 1;
      refreshPending = false;
    },
    refresh
  };
}
