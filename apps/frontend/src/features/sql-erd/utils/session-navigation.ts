const SQL_ERD_SESSION_PATH = "/sql-erd/session";

export function buildSqlErdSessionHref(sessionId: string) {
  const searchParams = new URLSearchParams({ sessionId });

  return `${SQL_ERD_SESSION_PATH}?${searchParams.toString()}`;
}

export function readSqlErdSessionId(search: string) {
  const sessionId = new URLSearchParams(search).get("sessionId")?.trim();

  return sessionId || null;
}
