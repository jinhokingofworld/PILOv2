import type { SqltoerdSessionSummary } from "@/features/sql-erd/types";

type SessionTitleUpdate = Pick<
  SqltoerdSessionSummary,
  "id" | "revision" | "title" | "updatedAt"
>;

export function getSqlErdCreateSessionTitle(value: string) {
  const title = value.trim();

  return title || undefined;
}

export function getSqlErdSessionTitleUpdate(value: string) {
  const title = value.trim();

  return title || null;
}

export function updateSqlErdSessionSummaryTitle(
  sessions: SqltoerdSessionSummary[],
  updatedSession: SessionTitleUpdate
) {
  return sessions
    .map((session) =>
      session.id === updatedSession.id
        ? {
            ...session,
            revision: updatedSession.revision,
            title: updatedSession.title,
            updatedAt: updatedSession.updatedAt
          }
        : session
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id)
    );
}
