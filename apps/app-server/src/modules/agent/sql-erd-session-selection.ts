import type { AgentJsonObject } from "./types/agent-tool.types";

export const SQL_ERD_SESSION_SELECTION_KIND = "sql_erd_session" as const;
export const MAX_SQL_ERD_SESSION_CANDIDATES = 5;

export type SqlErdSessionSelectionCandidate = {
  selectionToken: string;
  title: string;
  updatedAt: string;
  tableCount: number;
  relationCount: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_SELECTION_PATTERN =
  /^\[PILO_INTERNAL_SELECTION kind=sql_erd_session sessionSelectionToken=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\n([^\r\n]+)$/i;

export function isSqlErdSelectionToken(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeSqlErdSessionTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized || [...normalized].length > 120) return null;
  return normalized;
}

export function parseSqlErdSessionCandidates(
  value: unknown
): SqlErdSessionSelectionCandidate[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_SQL_ERD_SESSION_CANDIDATES
  ) {
    return [];
  }

  const tokenCounts = new Map<string, number>();
  for (const candidate of value) {
    if (isPlainObject(candidate) && isSqlErdSelectionToken(candidate.selectionToken)) {
      tokenCounts.set(
        candidate.selectionToken,
        (tokenCounts.get(candidate.selectionToken) ?? 0) + 1
      );
    }
  }
  const candidates = value.map((candidate) => {
    if (!isPlainObject(candidate)) return null;
    const title = normalizeSqlErdSessionTitle(candidate.title);
    const updatedAt = normalizeIsoDate(candidate.updatedAt);
    if (
      !isSqlErdSelectionToken(candidate.selectionToken) ||
      !title ||
      !updatedAt ||
      !isNonNegativeSafeInteger(candidate.tableCount) ||
      !isNonNegativeSafeInteger(candidate.relationCount)
    ) {
      return null;
    }
    return {
      selectionToken: candidate.selectionToken,
      title,
      updatedAt,
      tableCount: candidate.tableCount,
      relationCount: candidate.relationCount
    };
  });
  if (
    candidates.some(
      (candidate) =>
        candidate === null || tokenCounts.get(candidate.selectionToken) !== 1
    )
  ) {
    return [];
  }
  return candidates as SqlErdSessionSelectionCandidate[];
}

export function buildSqlErdSelectionDisplayMessage(title: string): string {
  return `${title} 세션을 선택했습니다.`;
}

export function buildStoredSqlErdSelectionMessage(
  selectionToken: string,
  title: string
): string {
  return `[PILO_INTERNAL_SELECTION kind=${SQL_ERD_SESSION_SELECTION_KIND} sessionSelectionToken=${selectionToken}]\n${buildSqlErdSelectionDisplayMessage(
    title
  )}`;
}

export function toPublicAgentMessageContent(content: string): string {
  return INTERNAL_SELECTION_PATTERN.exec(content)?.[2] ?? content;
}

export function containsReservedAgentSelectionMarker(content: string): boolean {
  return /^\[PILO_INTERNAL_SELECTION\b/i.test(content);
}

export function isSqlErdClarificationOutput(
  value: unknown
): value is AgentJsonObject {
  return isPlainObject(value) && value.status === "needs_clarification";
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString();
  return value === normalized ? normalized : null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPlainObject(value: unknown): value is AgentJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
