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

export function createDriveWorkspaceLocation(
  folderId: string | null,
  metrics: ScrollMetrics,
) {
  return {
    context: { folderId },
    page: "drive" as const,
    route: {
      pathname: "/files",
      search: folderId ? `?folderId=${encodeURIComponent(folderId)}` : "",
    },
    viewport: {
      key: "drive-list" as const,
      kind: "element" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function readDriveFolderId(location: {
  context: Record<string, string | null>;
}) {
  return location.context.folderId ?? null;
}

export function getDriveScrollOffset(
  viewport: { xRatio: number; yRatio: number },
  metrics: Omit<ScrollMetrics, "scrollLeft" | "scrollTop">,
) {
  return {
    left: viewport.xRatio * Math.max(metrics.scrollWidth - metrics.clientWidth, 0),
    top: viewport.yRatio * Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}
