export type BoardFollowSurfaceKey =
  | "board-kanban"
  | "board-issue-sheet";

type ScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

type ScrollSizeMetrics = Omit<ScrollMetrics, "scrollLeft" | "scrollTop">;

type BoardLocationLike = {
  context: Record<string, string | null | undefined>;
  page: string;
  viewport: {
    kind: string;
    key?: string;
    xRatio?: number;
    yRatio?: number;
  };
};

type BoardScrollTarget<T> = {
  boardId: string;
  element: T;
  issueId: string | null;
  surface: string;
};

function normalizedId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function isBoardSurface(value: string): value is BoardFollowSurfaceKey {
  return value === "board-kanban" || value === "board-issue-sheet";
}

function ratio(offset: number, size: number, clientSize: number) {
  const range = Math.max(size - clientSize, 0);
  return range
    ? Math.min(Math.max(offset / range, 0), 1)
    : 0;
}

export function createBoardWorkspaceLocation(
  input: {
    boardId: string;
    issueId: string | null;
    surface: BoardFollowSurfaceKey;
  },
  metrics: ScrollMetrics,
) {
  const boardId = normalizedId(input.boardId);
  const issueId = normalizedId(input.issueId);
  if (
    !boardId ||
    (input.surface === "board-kanban" && issueId) ||
    (input.surface === "board-issue-sheet" && !issueId)
  ) {
    return null;
  }

  const search = new URLSearchParams({ boardId });
  if (issueId) search.set("issueId", issueId);

  return {
    context: { boardId, issueId },
    page: "board" as const,
    route: { pathname: "/board" as const, search: `?${search.toString()}` },
    viewport: {
      key: input.surface,
      kind: "element" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

export function readBoardWorkspaceTarget(
  location: BoardLocationLike | null,
  allowedBoardIds: readonly string[],
) {
  if (!location || location.page !== "board") return null;

  const boardId = normalizedId(location.context.boardId);
  const issueId = normalizedId(location.context.issueId);
  const { viewport } = location;
  if (
    !boardId ||
    !allowedBoardIds.some((candidate) => normalizedId(candidate) === boardId) ||
    viewport.kind !== "element" ||
    !viewport.key ||
    !isBoardSurface(viewport.key) ||
    !Number.isFinite(viewport.xRatio) ||
    !Number.isFinite(viewport.yRatio) ||
    (viewport.key === "board-kanban" && issueId) ||
    (viewport.key === "board-issue-sheet" && !issueId)
  ) {
    return null;
  }

  return {
    boardId,
    issueId,
    surface: viewport.key,
    viewport: {
      kind: "element" as const,
      key: viewport.key,
      xRatio: viewport.xRatio!,
      yRatio: viewport.yRatio!,
    },
  };
}

export function getBoardScrollOffset(
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

export async function waitForBoardScrollTarget<T>(input: {
  boardId: string;
  findTarget: () => BoardScrollTarget<T> | null;
  intervalMs?: number;
  issueId: string | null;
  signal: AbortSignal;
  surface: BoardFollowSurfaceKey;
  timeoutMs?: number;
}): Promise<T | null> {
  const boardId = normalizedId(input.boardId);
  const issueId = normalizedId(input.issueId);
  if (!boardId || input.signal.aborted) return null;

  const deadline = Date.now() + (input.timeoutMs ?? 1_000);
  do {
    if (input.signal.aborted) return null;
    const target = input.findTarget();
    if (
      target &&
      normalizedId(target.boardId) === boardId &&
      normalizedId(target.issueId) === issueId &&
      target.surface === input.surface
    ) {
      return target.element;
    }
    if (Date.now() >= deadline) return null;
  } while (await waitForNextPoll(input.signal, input.intervalMs ?? 16));

  return null;
}
