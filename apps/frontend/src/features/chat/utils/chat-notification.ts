type NotificationUnreadCounts = {
  invitationUnread: number;
  mentionUnread: number;
};

export const CHAT_TARGET_UNAVAILABLE_MESSAGE =
  "해당 메시지를 확인할 수 없습니다";
export const CHAT_TARGET_VISIBILITY_THRESHOLD = 0;

export function getNotificationUnreadCount({
  invitationUnread,
  mentionUnread
}: NotificationUnreadCounts) {
  return normalizeUnreadCount(invitationUnread) + normalizeUnreadCount(mentionUnread);
}

export function formatChatNotificationBadgeCount(unreadCount: number) {
  const normalizedCount = normalizeUnreadCount(unreadCount);
  return normalizedCount > 99 ? "99+" : String(normalizedCount);
}

export function buildChatMentionHref(messageId: string) {
  return `/chat?messageId=${encodeURIComponent(messageId)}`;
}

export function shouldReadVisibleMention({
  targetMessageId,
  visibleMessageIds
}: {
  targetMessageId: string | null;
  visibleMessageIds: ReadonlySet<string>;
}) {
  return Boolean(targetMessageId && visibleMessageIds.has(targetMessageId));
}

export function createChatTargetFocusLifecycle() {
  type Ticket = { key: string };
  let active:
    | {
        status: "pending" | "positioned";
        ticket: Ticket;
      }
    | undefined;

  return {
    begin({
      targetAvailable,
      targetMessageId,
      workspaceId
    }: {
      targetAvailable: boolean;
      targetMessageId: string | null;
      workspaceId: string;
    }) {
      if (!targetAvailable || !targetMessageId || !workspaceId) return null;
      const key = `${workspaceId}:${targetMessageId}`;
      if (active?.ticket.key === key) return null;
      const ticket: Ticket = { key };
      active = { status: "pending", ticket };
      return ticket;
    },
    cancel(ticket: Ticket) {
      if (active?.ticket !== ticket || active.status !== "pending") return;
      active = undefined;
    },
    complete(ticket: Ticket) {
      if (active?.ticket !== ticket || active.status !== "pending") {
        return false;
      }
      active.status = "positioned";
      return true;
    },
    reset() {
      active = undefined;
    }
  };
}

export function createVisibleMentionReadRetry({
  clearScheduled = (handle) => clearTimeout(handle),
  maxAttempts = 2,
  retryDelayMs = 1_000,
  schedule = (callback, delay) => setTimeout(callback, delay)
}: {
  clearScheduled?: (handle: ReturnType<typeof setTimeout>) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
  schedule?: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>;
} = {}) {
  type RetryEntry = {
    attempts: number;
    generation: number;
    isCurrent: () => boolean;
    read: () => Promise<void>;
    timer?: ReturnType<typeof setTimeout>;
  };
  let generation = 0;
  const entries = new Map<string, RetryEntry>();

  const remove = (key: string, entry: RetryEntry) => {
    if (entries.get(key) === entry) entries.delete(key);
  };

  const attempt = async (key: string, entry: RetryEntry) => {
    if (entry.generation !== generation || !entry.isCurrent()) {
      remove(key, entry);
      return;
    }

    entry.attempts += 1;
    try {
      await entry.read();
    } catch {
      if (entry.generation !== generation || !entry.isCurrent()) {
        remove(key, entry);
        return;
      }
      if (entry.attempts >= maxAttempts) return;
      entry.timer = schedule(() => {
        entry.timer = undefined;
        void attempt(key, entry);
      }, retryDelayMs);
    }
  };

  return {
    reset() {
      generation += 1;
      for (const entry of entries.values()) {
        if (entry.timer !== undefined) clearScheduled(entry.timer);
      }
      entries.clear();
    },
    start({
      isCurrent,
      key,
      read
    }: {
      isCurrent: () => boolean;
      key: string;
      read: () => Promise<void>;
    }) {
      if (entries.has(key)) return;
      const entry: RetryEntry = {
        attempts: 0,
        generation,
        isCurrent,
        read
      };
      entries.set(key, entry);
      void attempt(key, entry);
    }
  };
}

export function navigateToChatMention({
  closePopover,
  markMentionRead,
  mentionId,
  messageId,
  navigate
}: {
  closePopover: () => void;
  markMentionRead: (mentionId: string) => Promise<void>;
  mentionId: string;
  messageId: string;
  navigate: (href: string) => void;
}) {
  closePopover();
  try {
    void markMentionRead(mentionId).catch(() => undefined);
  } catch {
    // Navigation must remain available even if a read adapter fails synchronously.
  }
  navigate(buildChatMentionHref(messageId));
}

export async function loadChatTargetIfMissing({
  hasLocalMessage,
  loadContext,
  targetMessageId
}: {
  hasLocalMessage: boolean;
  loadContext: (
    messageId: string
  ) => Promise<{ items: Array<{ id: string }> } | null>;
  targetMessageId: string;
}) {
  if (hasLocalMessage) return "local" as const;
  const context = await loadContext(targetMessageId);
  return context?.items.some(({ id }) => id === targetMessageId)
    ? ("loaded" as const)
    : ("missing" as const);
}

export function handleChatTargetLoadError({
  error,
  onError,
  replace
}: {
  error: unknown;
  onError: (message: string) => void;
  replace: (href: string) => void;
}) {
  if (isChatTargetNotFoundError(error)) {
    onError(CHAT_TARGET_UNAVAILABLE_MESSAGE);
    replace("/chat");
    return "not-found" as const;
  }

  onError("요청한 메시지를 불러오지 못했습니다.");
  return "error" as const;
}

export function formatChatNotificationTime(
  value: string,
  now: Date = new Date()
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 정보 없음";

  const elapsedMilliseconds = now.getTime() - date.getTime();
  if (elapsedMilliseconds >= 0 && elapsedMilliseconds < 60_000) return "방금 전";
  if (elapsedMilliseconds >= 0 && elapsedMilliseconds < 3_600_000) {
    return `${Math.floor(elapsedMilliseconds / 60_000)}분 전`;
  }
  if (elapsedMilliseconds >= 0 && elapsedMilliseconds < 86_400_000) {
    return `${Math.floor(elapsedMilliseconds / 3_600_000)}시간 전`;
  }

  return chatNotificationDateFormatter.format(date);
}

export function formatChatNotificationDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "시간 정보 없음"
    : chatNotificationDateTimeFormatter.format(date);
}

function normalizeUnreadCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function isChatTargetNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    error.name === "ChatApiError" &&
    "status" in error &&
    error.status === 404
  );
}

const chatNotificationDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium"
});

const chatNotificationDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "long",
  timeStyle: "short"
});
