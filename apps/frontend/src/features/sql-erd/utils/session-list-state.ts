export type SqlErdSessionListViewState =
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function getSqlErdSessionListViewState({
  errorMessage,
  hasLoadedSessions,
  isLoading,
  sessionCount
}: {
  errorMessage: string | null;
  hasLoadedSessions: boolean;
  isLoading: boolean;
  sessionCount: number;
}): SqlErdSessionListViewState {
  if (!hasLoadedSessions) {
    return errorMessage ? "error" : "loading";
  }

  if (isLoading && sessionCount === 0) {
    return "loading";
  }

  return sessionCount === 0 ? "empty" : "ready";
}

export function removeSqlErdSession<T extends { id: string }>(
  sessions: T[],
  sessionId: string
) {
  return sessions.filter((session) => session.id !== sessionId);
}
