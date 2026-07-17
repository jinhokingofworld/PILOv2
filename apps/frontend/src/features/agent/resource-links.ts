import type { AgentRun } from "@/features/agent/types";
import type { SqlErdAgentTableFocus } from "@/features/sql-erd/utils/agent-table-focus";

export type AgentResourceLink = {
  focus?: SqlErdAgentTableFocus;
  href: string;
  key: string;
  label: "ERD 및 DDL 열기" | "집중 보기 열기";
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

  const focus = parseSqlErdAgentTableFocusResource(resourceRef);
  return {
    ...(focus ? { focus } : {}),
    href: `${SQL_ERD_SESSION_PATH}?sessionId=${encodeURIComponent(resourceRef.resourceId)}`,
    key: `sqltoerd:session:${resourceRef.resourceId}`,
    label: focus ? "집중 보기 열기" : "ERD 및 DDL 열기"
  };
}

export function parseSqlErdAgentTableFocusResource(
  resourceRef: Record<string, unknown>
): SqlErdAgentTableFocus | null {
  if (
    typeof resourceRef.resourceId !== "string" ||
    !isPlainObject(resourceRef.metadata)
  ) {
    return null;
  }
  const metadata = resourceRef.metadata;
  if (
    metadata.version !== 1 ||
    metadata.view !== "table_focus" ||
    !Number.isSafeInteger(metadata.sessionRevision) ||
    Number(metadata.sessionRevision) < 1 ||
    typeof metadata.featureLabel !== "string" ||
    !isBoundedText(metadata.featureLabel, 100) ||
    typeof metadata.confidence !== "string" ||
    !["high", "medium", "low"].includes(metadata.confidence)
  ) {
    return null;
  }
  const primaryTableIds = readUniqueIds(metadata.primaryTableIds, 20, true);
  const relatedTableIds = readUniqueIds(metadata.relatedTableIds, 30, false);
  const relationIds = readUniqueIds(metadata.relationIds, 300, false);
  if (!primaryTableIds || !relatedTableIds || !relationIds) {
    return null;
  }
  const primarySet = new Set(primaryTableIds);
  if (relatedTableIds.some((id) => primarySet.has(id))) {
    return null;
  }

  return {
    version: 1,
    view: "table_focus",
    sessionId: resourceRef.resourceId,
    sessionRevision: Number(metadata.sessionRevision),
    featureLabel: metadata.featureLabel.trim().replace(/\s+/g, " "),
    primaryTableIds,
    relatedTableIds,
    relationIds,
    confidence: metadata.confidence as SqlErdAgentTableFocus["confidence"]
  };
}

function readUniqueIds(
  value: unknown,
  maxItems: number,
  requireOne: boolean
): string[] | null {
  if (
    !Array.isArray(value) ||
    (requireOne && value.length === 0) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    return null;
  }
  const ids = value.map((item) => String(item));
  return new Set(ids).size === ids.length ? ids : null;
}

function isBoundedText(value: string, maxLength: number): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && [...normalized].length <= maxLength;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
