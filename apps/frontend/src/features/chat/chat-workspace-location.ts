type ScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
};

type ScrollSizeMetrics = Omit<ScrollMetrics, "scrollLeft" | "scrollTop">;

function normalizedId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function ratio(offset: number, size: number, clientSize: number) {
  const range = Math.max(size - clientSize, 0);
  return range
    ? Math.min(Math.max(offset / range, 0), 1)
    : 0;
}

export function createChatWorkspaceLocation(
  messageId: string | null,
  metrics: ScrollMetrics,
) {
  const normalizedMessageId = normalizedId(messageId);
  return {
    context: { messageId: normalizedMessageId, threadId: null },
    page: "chat" as const,
    route: {
      pathname: "/chat" as const,
      search: normalizedMessageId
        ? `?messageId=${encodeURIComponent(normalizedMessageId)}`
        : "",
    },
    viewport: {
      kind: "element" as const,
      key: "chat-messages" as const,
      xRatio: ratio(metrics.scrollLeft, metrics.scrollWidth, metrics.clientWidth),
      yRatio: ratio(metrics.scrollTop, metrics.scrollHeight, metrics.clientHeight),
    },
  };
}

type ChatLocationLike = {
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

export function readChatTarget(location: ChatLocationLike | null) {
  const viewport = location?.viewport;
  if (
    !location ||
    location.page !== "chat" ||
    location.route.pathname !== "/chat" ||
    location.context.threadId !== null ||
    viewport?.kind !== "element" ||
    viewport.key !== "chat-messages" ||
    !Number.isFinite(viewport.xRatio) ||
    !Number.isFinite(viewport.yRatio)
  ) {
    return null;
  }
  return {
    messageId: normalizedId(location.context.messageId),
    viewport: {
      kind: "element" as const,
      key: "chat-messages" as const,
      xRatio: viewport.xRatio!,
      yRatio: viewport.yRatio!,
    },
  };
}

export function getChatScrollOffset(
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

export async function waitForChatScrollTarget<T>(input: {
  findTarget: () => T | null;
  intervalMs?: number;
  messageId: string | null;
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
