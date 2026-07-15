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

export function createMeetingWorkspaceLocation(
  meetingRoomId: string | null,
  metrics: ScrollMetrics,
) {
  return {
    context: { meetingRoomId },
    page: "meeting" as const,
    route: {
      pathname: "/meeting",
      search: meetingRoomId
        ? `?meetingRoomId=${encodeURIComponent(meetingRoomId)}`
        : "",
    },
    viewport: {
      kind: "document" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function readMeetingRoomId(
  location: { context: Record<string, string | null> },
  availableRoomIds: string[],
) {
  const roomId = location.context.meetingRoomId;
  return roomId && availableRoomIds.includes(roomId) ? roomId : null;
}

export function getMeetingScrollOffset(
  viewport: { xRatio: number; yRatio: number },
  metrics: Omit<ScrollMetrics, "scrollLeft" | "scrollTop">,
) {
  return {
    left: viewport.xRatio * Math.max(metrics.scrollWidth - metrics.clientWidth, 0),
    top: viewport.yRatio * Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}
