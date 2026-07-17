export const SQL_ERD_AGENT_TABLE_FOCUS_EVENT = "sql-erd:agent-table-focus";

const STORAGE_KEY_PREFIX = "pilo:sql-erd:agent-table-focus:";
const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
const MAX_PRIMARY_TABLES = 20;
const MAX_RELATED_TABLES = 30;
const MAX_RELATIONS = 300;

export type SqlErdAgentTableFocus = {
  version: 1;
  view: "table_focus";
  sessionId: string;
  sessionRevision: number;
  featureLabel: string;
  primaryTableIds: string[];
  relatedTableIds: string[];
  relationIds: string[];
  confidence: (typeof CONFIDENCE_VALUES)[number];
};

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
    !CONFIDENCE_VALUES.includes(
      metadata.confidence as (typeof CONFIDENCE_VALUES)[number]
    )
  ) {
    return null;
  }

  const primaryTableIds = readUniqueIds(
    metadata.primaryTableIds,
    MAX_PRIMARY_TABLES,
    true
  );
  const relatedTableIds = readUniqueIds(
    metadata.relatedTableIds,
    MAX_RELATED_TABLES,
    false
  );
  const relationIds = readUniqueIds(metadata.relationIds, MAX_RELATIONS, false);
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

export function stageSqlErdAgentTableFocus(
  focus: SqlErdAgentTableFocus
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(storageKey(focus.sessionId), JSON.stringify(focus));
  } catch {
    // Same-page delivery still works when storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent<SqlErdAgentTableFocus>(SQL_ERD_AGENT_TABLE_FOCUS_EVENT, {
      detail: focus
    })
  );
}

export function consumeStagedSqlErdAgentTableFocus(
  sessionId: string
): SqlErdAgentTableFocus | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = storageKey(sessionId);
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseStoredFocus(parsed, sessionId);
  } catch {
    return null;
  }
}

function parseStoredFocus(
  value: unknown,
  expectedSessionId: string
): SqlErdAgentTableFocus | null {
  if (!isPlainObject(value) || value.sessionId !== expectedSessionId) {
    return null;
  }
  const { sessionId: _sessionId, ...metadata } = value;
  return parseSqlErdAgentTableFocusResource({
    resourceId: expectedSessionId,
    metadata
  });
}

function storageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
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
