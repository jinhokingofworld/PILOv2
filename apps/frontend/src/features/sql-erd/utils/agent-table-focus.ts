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
  modelFingerprint: string;
  featureLabel: string;
  primaryTableIds: string[];
  relatedTableIds: string[];
  relationIds: string[];
  confidence: (typeof CONFIDENCE_VALUES)[number];
};

export type SqlErdFocusedTableRole = "primary" | "related" | "dimmed";
export type SqlErdFocusedRelationRole = "focused" | "dimmed";

export function createSqlErdModelFingerprint(modelJson: unknown): string {
  const serialized = JSON.stringify(modelJson, (_key, value) => {
    if (!isPlainObject(value)) {
      return value;
    }
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = value[key];
        return result;
      }, {});
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function getSqlErdFocusedTableRole(
  focus: SqlErdAgentTableFocus,
  tableId: string
): SqlErdFocusedTableRole {
  if (focus.primaryTableIds.includes(tableId)) {
    return "primary";
  }
  return focus.relatedTableIds.includes(tableId) ? "related" : "dimmed";
}

export function getSqlErdFocusedRelationRole(
  focus: SqlErdAgentTableFocus,
  relationId: string
): SqlErdFocusedRelationRole {
  return focus.relationIds.includes(relationId) ? "focused" : "dimmed";
}

export function isSqlErdAgentTableFocusCurrent(
  focus: SqlErdAgentTableFocus,
  context: {
    sessionId: string;
    sessionRevision: number | null;
    modelJson: unknown;
    revisionValidated: boolean;
  }
): boolean {
  return (
    focus.sessionId === context.sessionId &&
    context.sessionRevision !== null &&
    focus.modelFingerprint === createSqlErdModelFingerprint(context.modelJson) &&
    (context.revisionValidated ||
      focus.sessionRevision === context.sessionRevision)
  );
}

export function isSqlErdShapeDimmedByTableFocus(
  focus: SqlErdAgentTableFocus,
  shape: { type: string; props?: Record<string, unknown> }
): boolean {
  if (shape.type === "sqltoerd_table") {
    return (
      typeof shape.props?.tableId === "string" &&
      getSqlErdFocusedTableRole(focus, shape.props.tableId) === "dimmed"
    );
  }
  if (shape.type === "sqltoerd_relation") {
    return (
      typeof shape.props?.relationId === "string" &&
      getSqlErdFocusedRelationRole(focus, shape.props.relationId) === "dimmed"
    );
  }
  return false;
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
    typeof metadata.modelFingerprint !== "string" ||
    !/^fnv1a32:[0-9a-f]{8}$/.test(metadata.modelFingerprint) ||
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
    modelFingerprint: metadata.modelFingerprint,
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
    return parseSqlErdAgentTableFocusValue(parsed, sessionId);
  } catch {
    return null;
  }
}

export function parseSqlErdAgentTableFocusValue(
  value: unknown,
  expectedSessionId?: string
): SqlErdAgentTableFocus | null {
  if (
    !isPlainObject(value) ||
    typeof value.sessionId !== "string" ||
    (expectedSessionId !== undefined && value.sessionId !== expectedSessionId)
  ) {
    return null;
  }
  const { sessionId, ...metadata } = value;
  return parseSqlErdAgentTableFocusResource({
    resourceId: sessionId,
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
