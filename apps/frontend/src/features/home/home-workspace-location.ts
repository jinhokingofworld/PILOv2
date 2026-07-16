type ScrollCaptureMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

type ScrollRestoreMetrics = Omit<ScrollCaptureMetrics, "scrollLeft" | "scrollTop">;

function ratio(offset: number, scrollSize: number, clientSize: number) {
  const range = Math.max(scrollSize - clientSize, 0);
  return range ? Math.min(Math.max(offset / range, 0), 1) : 0;
}

export function createHomeWorkspaceLocation(metrics: ScrollCaptureMetrics) {
  return {
    context: {},
    page: "home" as const,
    route: { pathname: "/home", search: "" },
    viewport: {
      kind: "document" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function getHomeScrollOffset(
  viewport: { xRatio: number; yRatio: number },
  metrics: ScrollRestoreMetrics,
) {
  return {
    left: viewport.xRatio * Math.max(metrics.scrollWidth - metrics.clientWidth, 0),
    top: viewport.yRatio * Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}
