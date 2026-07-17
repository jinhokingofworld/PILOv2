const SQL_ERD_SESSION_PATH = "/sql-erd/session";
const PR_REVIEW_SESSION_PATH = "/pr-review";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAgentRequestContext(pathname: string, search: string) {
  const normalizedPathname = pathname.replace(/\/+$/, "");
  const searchParams = new URLSearchParams(search);
  const sessionId =
    normalizedPathname === SQL_ERD_SESSION_PATH
      ? searchParams.get("sessionId")?.trim()
      : normalizedPathname === PR_REVIEW_SESSION_PATH
        ? searchParams.get("reviewSessionId")?.trim()
        : null;
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    return null;
  }

  if (normalizedPathname === PR_REVIEW_SESSION_PATH) {
    return {
      surface: "pr_review" as const,
      sessionId
    };
  }

  if (normalizedPathname !== SQL_ERD_SESSION_PATH) {
    return null;
  }

  return {
    surface: "sql_erd" as const,
    sessionId
  };
}
