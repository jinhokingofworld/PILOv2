export type SqlErdSessionHeaderTitleSnapshot = {
  sessionId: string;
  title: string | null;
};

let snapshot: SqlErdSessionHeaderTitleSnapshot | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function getSqlErdSessionHeaderTitleSnapshot() {
  return snapshot;
}

export function resolveSqlErdSessionHeaderTitle(
  currentSnapshot: SqlErdSessionHeaderTitleSnapshot | null,
  currentSessionId: string | null,
  fallback: string
) {
  return currentSnapshot?.sessionId === currentSessionId &&
    currentSnapshot.title
    ? currentSnapshot.title
    : fallback;
}

export function subscribeSqlErdSessionHeaderTitle(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSqlErdSessionHeaderTitle(
  sessionId: string,
  title: string | null
) {
  const normalizedTitle = title?.trim() || null;

  if (
    snapshot?.sessionId === sessionId &&
    snapshot.title === normalizedTitle
  ) {
    return;
  }

  snapshot = { sessionId, title: normalizedTitle };
  emitChange();
}

export function clearSqlErdSessionHeaderTitle(sessionId: string) {
  if (snapshot?.sessionId !== sessionId) {
    return;
  }

  snapshot = null;
  emitChange();
}
