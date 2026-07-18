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

export function createMeetingReportRequestGuard() {
  let sequence = 0;
  return {
    begin(reportId: string) {
      return { reportId, sequence: ++sequence };
    },
    invalidate() {
      sequence += 1;
    },
    isCurrent(ticket: { reportId: string; sequence: number }) {
      return ticket.sequence === sequence;
    },
  };
}

export function createMeetingWorkspaceLocation(
  meetingRoomId: string | null,
  metrics: ScrollMetrics,
) {
  return {
    context: { meetingRoomId, reportId: null },
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

export function createMeetingReportWorkspaceLocation(
  reportId: string | null,
  metrics: ScrollMetrics,
) {
  const viewport = {
    xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
    yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
  };
  return {
    context: { meetingRoomId: null, reportId },
    page: "meeting" as const,
    route: {
      pathname: "/report",
      search: reportId ? `?reportId=${encodeURIComponent(reportId)}` : "",
    },
    viewport: reportId
      ? {
          ...viewport,
          kind: "element" as const,
          key: "meeting-content" as const,
        }
      : { ...viewport, kind: "document" as const },
  };
}

export function readMeetingRoomId(
  location: { context: Record<string, string | null> },
  availableRoomIds: string[],
) {
  const roomId = location.context.meetingRoomId;
  if (roomId === null) return null;
  return roomId && availableRoomIds.includes(roomId) ? roomId : undefined;
}

type MeetingLocationLike = {
  context: Record<string, string | null | undefined>;
  page: string;
  route: { pathname: string };
  viewport: {
    kind: string;
    key?: string;
    xRatio?: number;
    yRatio?: number;
  };
};

export function readMeetingReportTarget(location: MeetingLocationLike | null) {
  const reportId = location?.context.reportId?.trim() ?? "";
  const viewport = location?.viewport;
  if (
    !location ||
    location.page !== "meeting" ||
    location.route.pathname !== "/report" ||
    location.context.meetingRoomId !== null ||
    !reportId ||
    viewport?.kind !== "element" ||
    viewport.key !== "meeting-content" ||
    !Number.isFinite(viewport.xRatio) ||
    !Number.isFinite(viewport.yRatio)
  ) {
    return null;
  }
  return {
    reportId,
    viewport: {
      kind: "element" as const,
      key: "meeting-content" as const,
      xRatio: viewport.xRatio!,
      yRatio: viewport.yRatio!,
    },
  };
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

export async function waitForMeetingContentTarget<T>(input: {
  findTarget: () => T | null;
  intervalMs?: number;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<T | null> {
  if (input.signal.aborted) return null;
  const deadline = Date.now() + (input.timeoutMs ?? 1_000);
  do {
    if (input.signal.aborted) return null;
    const target = input.findTarget();
    if (target) return target;
    if (Date.now() >= deadline) return null;
  } while (await waitForNextPoll(input.signal, input.intervalMs ?? 16));
  return null;
}
