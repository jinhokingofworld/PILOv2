import {
  normalizePageCursorRoomRef,
} from "./page-cursor-room";
import type {
  PageCursorPointRatio,
  PageCursorRoomRef,
  PageCursorTargetRef,
  PageCursorUpdatePayload,
} from "./page-cursor-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value !== "string") return null;
  const trimmedValue = value.trim();

  return trimmedValue || null;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRatio(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function readPointRatio(value: unknown): PageCursorPointRatio | null {
  if (!isRecord(value)) return null;
  if (!isRatio(value.xRatio) || !isRatio(value.yRatio)) return null;

  return {
    xRatio: value.xRatio,
    yRatio: value.yRatio,
  };
}

function readTarget(value: unknown): PageCursorTargetRef | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;

  const type = readRequiredString(value, "type");
  const id = readRequiredString(value, "id");

  if (!type || !id || type.length > 80 || id.length > 256) {
    return null;
  }

  const label = typeof value.label === "string" ? value.label.trim().slice(0, 80) : null;

  return {
    id,
    ...(label ? { label } : {}),
    type,
  };
}

export function readPageCursorRoomRef(payload: unknown): PageCursorRoomRef | null {
  if (!isRecord(payload)) return null;

  const workspaceId = readRequiredString(payload, "workspaceId");
  const page = readRequiredString(payload, "page");
  const boardId = typeof payload.boardId === "string" ? payload.boardId.trim() : undefined;

  if (!workspaceId || !page) return null;

  return normalizePageCursorRoomRef({
    ...(boardId ? { boardId } : {}),
    page,
    workspaceId,
  } as PageCursorRoomRef);
}

export function readPageCursorUpdatePayload(
  payload: unknown,
): PageCursorUpdatePayload | null {
  const room = readPageCursorRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const fallback = readPointRatio(payload.fallback);
  const target = readTarget(payload.target);
  const targetPoint = payload.targetPoint === null ? null : readPointRatio(payload.targetPoint);

  if (!fallback) return null;
  if (payload.target !== null && !target) return null;
  if (target && !targetPoint) return null;
  if (!target && targetPoint !== null) return null;
  if (payload.sentAt !== undefined && !isIsoDateString(payload.sentAt)) return null;

  return {
    ...room,
    fallback,
    ...(payload.sentAt ? { sentAt: payload.sentAt as string } : {}),
    target,
    targetPoint,
  };
}
