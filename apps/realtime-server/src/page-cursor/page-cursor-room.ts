import type { BoardAccessContext, BoardAccessService } from "../board/board-access.service";
import { parseBoardRoomRef } from "../board/board-payload.parser";
import type { PageCursorRoomRef } from "./page-cursor-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPageCursorRoomName(room: PageCursorRoomRef) {
  const workspaceRoom = `workspace:${room.workspaceId}:page:${room.page}`;

  if (room.page === "board" && room.boardId) {
    return `${workspaceRoom}:${room.boardId}`;
  }

  return workspaceRoom;
}

export async function canJoinPageCursorRoom({
  accessService,
  context,
  room,
}: {
  accessService: BoardAccessService;
  context: BoardAccessContext;
  room: PageCursorRoomRef;
}) {
  if (!UUID_PATTERN.test(room.workspaceId)) {
    return false;
  }

  if (room.page === "board" && room.boardId) {
    return accessService.canJoinBoard(context, {
      boardId: room.boardId,
      workspaceId: room.workspaceId,
    });
  }

  return accessService.canJoinWorkspace(context, room.workspaceId);
}

export function normalizePageCursorRoomRef(
  payload: PageCursorRoomRef,
): PageCursorRoomRef | null {
  if (!UUID_PATTERN.test(payload.workspaceId)) return null;

  const workspaceId = payload.workspaceId.toLowerCase();

  if (payload.page !== "home" && payload.page !== "calendar" && payload.page !== "board") {
    return null;
  }

  if (payload.page !== "board") {
    return {
      page: payload.page,
      workspaceId,
    };
  }

  if (!payload.boardId) {
    return {
      page: "board",
      workspaceId,
    };
  }

  const boardRoom = parseBoardRoomRef({
    boardId: payload.boardId,
    workspaceId,
  });

  if (!boardRoom) return null;

  return {
    boardId: boardRoom.boardId,
    page: "board",
    workspaceId: boardRoom.workspaceId,
  };
}
