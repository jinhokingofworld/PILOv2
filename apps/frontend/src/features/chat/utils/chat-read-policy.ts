export function shouldMarkChatRead({
  pathname,
  documentVisible,
  bottomVisible
}: {
  pathname: string;
  documentVisible: boolean;
  bottomVisible: boolean;
}) {
  return (
    (pathname === "/chat" || pathname.startsWith("/chat/")) &&
    documentVisible &&
    bottomVisible
  );
}

export function shouldObserveChatRead({
  targetMessageId,
  targetPositioned
}: {
  targetMessageId: string | null;
  targetPositioned: boolean;
}) {
  return targetMessageId === null || targetPositioned;
}

export function findFirstUnreadChatMessageIndex(
  messages: Array<{ id: string }>,
  lastReadMessageId: string | null,
  unreadCount: number
) {
  if (unreadCount <= 0 || messages.length === 0) return -1;

  if (lastReadMessageId) {
    const lastReadIndex = messages.findIndex(
      ({ id }) => id === lastReadMessageId
    );
    if (lastReadIndex >= 0 && lastReadIndex < messages.length - 1) {
      return lastReadIndex + 1;
    }
  }

  return Math.max(messages.length - unreadCount, 0);
}

export function preservePrependScrollTop({
  previousScrollHeight,
  previousScrollTop,
  nextScrollHeight
}: {
  previousScrollHeight: number;
  previousScrollTop: number;
  nextScrollHeight: number;
}) {
  return previousScrollTop + nextScrollHeight - previousScrollHeight;
}

export function mergeChronologicalChatMessages<
  T extends { id: string; createdAt: string }
>(...messageGroups: T[][]) {
  const messagesById = new Map<string, T>();
  for (const group of messageGroups) {
    for (const message of group) messagesById.set(message.id, message);
  }

  return [...messagesById.values()].sort(
    (first, second) =>
      first.createdAt.localeCompare(second.createdAt) ||
      first.id.localeCompare(second.id)
  );
}
