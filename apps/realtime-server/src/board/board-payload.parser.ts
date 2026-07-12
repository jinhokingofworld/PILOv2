import type { BoardInvalidationPayload, BoardRoomRef } from "./board-types";

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value;
}

function isCanonicalPositiveSafeInteger(value: string) {
  return POSITIVE_INTEGER_PATTERN.test(value) && Number.isSafeInteger(Number(value));
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseBoardRoomRef(payload: unknown): BoardRoomRef | null {
  if (!isRecord(payload)) {
    return null;
  }

  const workspaceId = readRequiredString(payload, "workspaceId");
  const boardId = readRequiredString(payload, "boardId");

  if (
    !workspaceId ||
    !boardId ||
    !UUID_PATTERN.test(workspaceId) ||
    !isCanonicalPositiveSafeInteger(boardId)
  ) {
    return null;
  }

  return {
    boardId,
    workspaceId: workspaceId.toLowerCase(),
  };
}

export function parseBoardInvalidationPayload(
  payload: unknown,
): BoardInvalidationPayload | null {
  const room = parseBoardRoomRef(payload);

  if (!room || !isRecord(payload) || !isIsoDateString(payload.updatedAt)) {
    return null;
  }

  return {
    ...room,
    updatedAt: payload.updatedAt,
  };
}
