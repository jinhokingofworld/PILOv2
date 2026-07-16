import type {
  GithubSourceInvalidation,
  GithubSourceRoomRef
} from "./github-source-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseGithubSourceRoomRef(
  payload: unknown
): GithubSourceRoomRef | null {
  if (
    !isRecord(payload) ||
    Object.keys(payload).some((key) => key !== "workspaceId") ||
    !isUuid(payload.workspaceId)
  ) {
    return null;
  }
  return { workspaceId: payload.workspaceId.toLowerCase() };
}

export function parseGithubSourceInvalidation(
  payload: unknown
): GithubSourceInvalidation | null {
  if (!isRecord(payload)) {
    return null;
  }
  const allowed = new Set([
    "repositoryId",
    "sourceId",
    "sourceNumber",
    "sourceType",
    "updatedAt",
    "workspaceId"
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    return null;
  }
  const room = parseGithubSourceRoomRef({ workspaceId: payload.workspaceId });
  if (
    !room ||
    !isUuid(payload.repositoryId) ||
    !isUuid(payload.sourceId) ||
    typeof payload.sourceNumber !== "number" ||
    !Number.isSafeInteger(payload.sourceNumber) ||
    payload.sourceNumber <= 0 ||
    (payload.sourceType !== "issue" && payload.sourceType !== "pull_request") ||
    typeof payload.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.updatedAt))
  ) {
    return null;
  }
  return {
    ...room,
    repositoryId: payload.repositoryId.toLowerCase(),
    sourceId: payload.sourceId.toLowerCase(),
    sourceNumber: payload.sourceNumber,
    sourceType: payload.sourceType,
    updatedAt: payload.updatedAt
  };
}
