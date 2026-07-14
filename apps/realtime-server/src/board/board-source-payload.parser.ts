import type { BoardSourceRoomRef, BoardSourceUpdatedPayload } from "./board-source-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBoardSourceRoomRef(payload: unknown): BoardSourceRoomRef | null {
  if (!isRecord(payload) || Object.keys(payload).some((key) => key !== "workspaceId")) return null;
  const workspaceId = payload.workspaceId;
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)) return null;
  return { workspaceId: workspaceId.toLowerCase() };
}

export function parseBoardSourceUpdatedPayload(payload: unknown): BoardSourceUpdatedPayload | null {
  if (!isRecord(payload)) return null;
  const allowed = new Set(["workspaceId", "boardId", "changedAt"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;
  const room = parseBoardSourceRoomRef({ workspaceId: payload.workspaceId });
  if (!room || typeof payload.boardId !== "string" || !POSITIVE_INTEGER_PATTERN.test(payload.boardId)) return null;
  if (typeof payload.changedAt !== "string" || !Number.isFinite(Date.parse(payload.changedAt))) return null;
  return { ...room, boardId: payload.boardId, changedAt: payload.changedAt };
}
