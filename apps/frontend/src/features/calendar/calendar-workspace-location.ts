export type CalendarFollowSurfaceKey =
  | "calendar-grid"
  | "calendar-event-detail"
  | "calendar-events-dialog";

type ScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

type ScrollSizeMetrics = Omit<ScrollMetrics, "scrollLeft" | "scrollTop">;

type CalendarLocationLike = {
  context: Record<string, string | null | undefined>;
  page: string;
  viewport: {
    kind: string;
    key?: string;
    xRatio?: number;
    yRatio?: number;
  };
};

type CalendarScrollTarget<T> = {
  element: T;
  eventId: string | null;
  selectedDate: string;
  surface: string;
};

function normalizedId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function isCalendarDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isCalendarSurface(value: string): value is CalendarFollowSurfaceKey {
  return (
    value === "calendar-grid" ||
    value === "calendar-event-detail" ||
    value === "calendar-events-dialog"
  );
}

function ratio(offset: number, size: number, clientSize: number) {
  const range = Math.max(size - clientSize, 0);
  return range
    ? Math.min(Math.max(offset / range, 0), 1)
    : 0;
}

export function createCalendarWorkspaceLocation(
  input: {
    eventId: string | null;
    selectedDate: string;
    surface: CalendarFollowSurfaceKey;
  },
  metrics: ScrollMetrics,
) {
  const eventId = normalizedId(input.eventId);
  if (
    !isCalendarDate(input.selectedDate) ||
    (input.surface === "calendar-event-detail" && !eventId) ||
    (input.surface !== "calendar-event-detail" && eventId)
  ) {
    return null;
  }

  return {
    context: { eventId, selectedDate: input.selectedDate },
    page: "calendar" as const,
    route: {
      pathname: "/calendar" as const,
      search: `?date=${encodeURIComponent(input.selectedDate)}`,
    },
    viewport: {
      key: input.surface,
      kind: "element" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function readCalendarWorkspaceTarget(
  location: CalendarLocationLike | null,
) {
  if (!location || location.page !== "calendar") return null;

  const selectedDate = location.context.selectedDate;
  const eventId = normalizedId(location.context.eventId);
  const { viewport } = location;
  if (
    !isCalendarDate(selectedDate) ||
    viewport.kind !== "element" ||
    !viewport.key ||
    !isCalendarSurface(viewport.key) ||
    !Number.isFinite(viewport.xRatio) ||
    !Number.isFinite(viewport.yRatio) ||
    (viewport.key === "calendar-event-detail" && !eventId) ||
    (viewport.key !== "calendar-event-detail" && eventId)
  ) {
    return null;
  }

  return {
    eventId,
    selectedDate,
    surface: viewport.key,
    viewport: {
      kind: "element" as const,
      key: viewport.key,
      xRatio: viewport.xRatio!,
      yRatio: viewport.yRatio!,
    },
  };
}

export function getCalendarScrollOffset(
  viewport: { xRatio: number; yRatio: number },
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

export async function waitForCalendarScrollTarget<T>(input: {
  eventId: string | null;
  findTarget: () => CalendarScrollTarget<T> | null;
  intervalMs?: number;
  selectedDate: string;
  signal: AbortSignal;
  surface: CalendarFollowSurfaceKey;
  timeoutMs?: number;
}): Promise<T | null> {
  const eventId = normalizedId(input.eventId);
  if (!isCalendarDate(input.selectedDate) || input.signal.aborted) return null;

  const deadline = Date.now() + (input.timeoutMs ?? 1_000);
  do {
    if (input.signal.aborted) return null;
    const target = input.findTarget();
    if (
      target &&
      normalizedId(target.eventId) === eventId &&
      target.selectedDate === input.selectedDate &&
      target.surface === input.surface
    ) {
      return target.element;
    }
    if (Date.now() >= deadline) return null;
  } while (await waitForNextPoll(input.signal, input.intervalMs ?? 16));

  return null;
}
