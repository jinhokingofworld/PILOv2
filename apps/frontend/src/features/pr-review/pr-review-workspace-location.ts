type Camera = { x: number; y: number; z: number };

type ScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

function ratio(offset: number, size: number, clientSize: number) {
  const range = Math.max(size - clientSize, 0);
  return range ? Math.min(Math.max(offset / range, 0), 1) : 0;
}

export function createPrReviewDocumentWorkspaceLocation(metrics: ScrollMetrics) {
  return {
    context: { reviewSessionId: null },
    page: "pr-review" as const,
    route: { pathname: "/pr-review", search: "" },
    viewport: {
      kind: "document" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function getPrReviewDocumentScrollOffset(
  viewport: { xRatio: number; yRatio: number },
  metrics: Omit<ScrollMetrics, "scrollLeft" | "scrollTop">,
) {
  return {
    left: viewport.xRatio * Math.max(metrics.scrollWidth - metrics.clientWidth, 0),
    top: viewport.yRatio * Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}

export function createPrReviewWorkspaceLocation(
  reviewSessionId: string,
  camera: Camera,
) {
  return {
    context: { reviewSessionId },
    page: "pr-review" as const,
    route: {
      pathname: "/pr-review",
      search: `?reviewSessionId=${encodeURIComponent(reviewSessionId)}`,
    },
    viewport: { kind: "camera" as const, ...camera },
  };
}

export function readPrReviewCamera(
  location: {
    context: Record<string, string | null>;
    viewport: { kind: string; x?: number; y?: number; z?: number };
  },
  reviewSessionId: string,
): Camera | null {
  const { viewport } = location;
  if (
    location.context.reviewSessionId !== reviewSessionId ||
    viewport.kind !== "camera" ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.z)
  ) {
    return null;
  }
  return { x: viewport.x!, y: viewport.y!, z: viewport.z! };
}
