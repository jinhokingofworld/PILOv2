export type PrReviewFollowSurfaceKey =
  | "pr-review-diff"
  | "pr-review-inspector";

type ScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

type ScrollSizeMetrics = Omit<ScrollMetrics, "scrollLeft" | "scrollTop">;

export type PrReviewElementViewport = {
  kind: "element";
  key: PrReviewFollowSurfaceKey;
  xRatio: number;
  yRatio: number;
};

type PrReviewLocationLike = {
  context: Record<string, string | null | undefined>;
  page: string;
  viewport: {
    kind: string;
    key?: string;
    xRatio?: number;
    yRatio?: number;
  };
};

function isFollowSurface(value: string): value is PrReviewFollowSurfaceKey {
  return value === "pr-review-diff" || value === "pr-review-inspector";
}

function normalizedId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function ratio(offset: number, size: number, clientSize: number) {
  const range = Math.max(size - clientSize, 0);
  if (!range) return 0;
  return Math.min(Math.max(offset / range, 0), 1);
}

export function createPrReviewDiffLocation(input: {
  metrics: ScrollMetrics;
  reviewFileId: string;
  reviewSessionId: string;
  surface: string;
}) {
  const reviewFileId = normalizedId(input.reviewFileId);
  const reviewSessionId = normalizedId(input.reviewSessionId);
  if (!reviewFileId || !reviewSessionId || !isFollowSurface(input.surface)) {
    return null;
  }

  return {
    context: { reviewFileId, reviewSessionId },
    page: "pr-review" as const,
    route: {
      pathname: "/pr-review" as const,
      search: `?reviewSessionId=${encodeURIComponent(reviewSessionId)}`,
    },
    viewport: {
      kind: "element" as const,
      key: input.surface,
      xRatio: ratio(
        input.metrics.scrollLeft,
        input.metrics.scrollWidth,
        input.metrics.clientWidth,
      ),
      yRatio: ratio(
        input.metrics.scrollTop,
        input.metrics.scrollHeight,
        input.metrics.clientHeight,
      ),
    },
  };
}

export function readPrReviewDiffTarget(
  location: PrReviewLocationLike | null,
  currentReviewSessionId: string,
) {
  const currentSessionId = normalizedId(currentReviewSessionId);
  if (!location || location.page !== "pr-review" || !currentSessionId) {
    return null;
  }

  const reviewSessionId = normalizedId(location.context.reviewSessionId);
  const reviewFileId = normalizedId(location.context.reviewFileId);
  const { viewport } = location;
  if (
    reviewSessionId !== currentSessionId ||
    !reviewFileId ||
    viewport.kind !== "element" ||
    !viewport.key ||
    !isFollowSurface(viewport.key) ||
    !Number.isFinite(viewport.xRatio) ||
    !Number.isFinite(viewport.yRatio)
  ) {
    return null;
  }

  return {
    reviewFileId,
    surface: viewport.key,
    viewport: {
      kind: "element" as const,
      key: viewport.key,
      xRatio: viewport.xRatio!,
      yRatio: viewport.yRatio!,
    },
  };
}

export function getPrReviewScrollOffset(
  viewport: Pick<PrReviewElementViewport, "xRatio" | "yRatio">,
  metrics: ScrollSizeMetrics,
) {
  return {
    left:
      Math.min(Math.max(viewport.xRatio, 0), 1) *
      Math.max(metrics.scrollWidth - metrics.clientWidth, 0),
    top:
      Math.min(Math.max(viewport.yRatio, 0), 1) *
      Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}

type PrReviewScrollTarget<T> = {
  element: T;
  reviewFileId: string;
  surface: string;
};

function waitForNextPoll(signal: AbortSignal, intervalMs: number) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const onAbort = () => {
      clearTimeout(timerId);
      resolve(false);
    };
    const timerId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForPrReviewScrollTarget<T>(input: {
  findTarget: () => PrReviewScrollTarget<T> | null;
  intervalMs?: number;
  reviewFileId: string;
  signal: AbortSignal;
  surface: PrReviewFollowSurfaceKey;
  timeoutMs?: number;
}): Promise<T | null> {
  const reviewFileId = normalizedId(input.reviewFileId);
  if (!reviewFileId || input.signal.aborted) return null;

  const deadline = Date.now() + (input.timeoutMs ?? 1_000);
  do {
    if (input.signal.aborted) return null;
    const target = input.findTarget();
    if (
      target &&
      normalizedId(target.reviewFileId) === reviewFileId &&
      target.surface === input.surface
    ) {
      return target.element;
    }
    if (Date.now() >= deadline) return null;
  } while (await waitForNextPoll(input.signal, input.intervalMs ?? 16));

  return null;
}
