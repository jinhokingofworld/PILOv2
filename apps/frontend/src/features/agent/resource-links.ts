import type { AgentRun } from "@/features/agent/types";

export type AgentResourceLink = {
  href: string;
  key: string;
  label: "ERD 및 DDL 열기";
};

const SQL_ERD_SESSION_PATH = "/sql-erd/session";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAgentResourceLinks(
  run: Pick<AgentRun, "status" | "steps"> | null | undefined
): AgentResourceLink[] {
  if (run?.status !== "completed") {
    return [];
  }

  const links = new Map<string, AgentResourceLink>();
  for (const step of run.steps) {
    if (step.status !== "completed") {
      continue;
    }

    for (const resourceRef of step.resourceRefs) {
      const link = toSqlErdSessionLink(resourceRef);
      if (link) {
        links.set(link.key, link);
      }
    }
  }

  return [...links.values()];
}

function toSqlErdSessionLink(
  resourceRef: Record<string, unknown>
): AgentResourceLink | null {
  if (
    resourceRef.domain !== "sqltoerd" ||
    resourceRef.resourceType !== "session" ||
    typeof resourceRef.resourceId !== "string" ||
    !UUID_PATTERN.test(resourceRef.resourceId) ||
    typeof resourceRef.url !== "string"
  ) {
    return null;
  }

  const rawUrl = resourceRef.url;
  if (!rawUrl.startsWith("/") || rawUrl.startsWith("//") || rawUrl.includes("\\")) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl, "https://pilo.local");
  } catch {
    return null;
  }

  const queryKeys = [...parsedUrl.searchParams.keys()];
  const sessionIds = parsedUrl.searchParams.getAll("sessionId");
  if (
    parsedUrl.origin !== "https://pilo.local" ||
    parsedUrl.pathname !== SQL_ERD_SESSION_PATH ||
    parsedUrl.hash !== "" ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== "sessionId" ||
    sessionIds.length !== 1 ||
    sessionIds[0] !== resourceRef.resourceId
  ) {
    return null;
  }

  return {
    href: `${SQL_ERD_SESSION_PATH}?sessionId=${encodeURIComponent(resourceRef.resourceId)}`,
    key: `sqltoerd:session:${resourceRef.resourceId}`,
    label: "ERD 및 DDL 열기"
  };
}
