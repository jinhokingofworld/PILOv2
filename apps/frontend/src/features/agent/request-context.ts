const SQL_ERD_SESSION_PATH = "/sql-erd/session";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAgentRequestContext(pathname: string, search: string) {
  const normalizedPathname = pathname.replace(/\/+$/, "");
  if (normalizedPathname !== SQL_ERD_SESSION_PATH) {
    return null;
  }

  const sessionId = new URLSearchParams(search).get("sessionId")?.trim();
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    return null;
  }

  return {
    surface: "sql_erd" as const,
    sessionId
  };
}
