import type {
  PdfCollaborationPointer,
  PdfCollaborationPoint,
  PdfCollaborationPresence,
  PdfCollaborationRoomRef,
  PdfCollaborationSnapshot,
  PdfCollaborationStroke,
} from "./pdf-collaboration-types";

type RoomState = {
  pointersBySocketId: Map<string, PdfCollaborationPointer>;
  presenceBySocketId: Map<string, PdfCollaborationPresence>;
  strokesByPage: Map<number, Map<string, PdfCollaborationStroke>>;
};

type JoinPresence = Pick<PdfCollaborationPresence, "displayName" | "pageNumber" | "userId">;

function roomKey(room: PdfCollaborationRoomRef) {
  return `workspace:${room.workspaceId}:pdf:${room.fileId}`;
}

export function createPdfCollaborationRoomState() {
  const rooms = new Map<string, RoomState>();

  function getOrCreateRoom(room: PdfCollaborationRoomRef) {
    const roomName = roomKey(room);
    let state = rooms.get(roomName);
    if (!state) {
      state = {
        pointersBySocketId: new Map(),
        presenceBySocketId: new Map(),
        strokesByPage: new Map(),
      };
      rooms.set(roomName, state);
    }
    return state;
  }

  function getRoom(room: PdfCollaborationRoomRef) {
    return rooms.get(roomKey(room)) ?? null;
  }

  function getSnapshot(room: PdfCollaborationRoomRef): PdfCollaborationSnapshot | null {
    const state = getRoom(room);
    if (!state) return null;

    return {
      ...room,
      presence: Array.from(state.presenceBySocketId.values()),
      pointers: Array.from(state.pointersBySocketId.values()),
      strokesByPage: Object.fromEntries(
        Array.from(state.strokesByPage.entries()).map(([pageNumber, strokes]) => [
          pageNumber,
          Array.from(strokes.values()),
        ]),
      ),
    };
  }

  function removeSocket(room: PdfCollaborationRoomRef, socketId: string) {
    const roomName = roomKey(room);
    const state = rooms.get(roomName);
    if (!state) return null;

    const presence = state.presenceBySocketId.get(socketId) ?? null;
    state.presenceBySocketId.delete(socketId);
    state.pointersBySocketId.delete(socketId);
    if (state.presenceBySocketId.size === 0) rooms.delete(roomName);
    return presence;
  }

  return {
    join(room: PdfCollaborationRoomRef, socketId: string, presence: JoinPresence) {
      const state = getOrCreateRoom(room);
      state.presenceBySocketId.set(socketId, {
        ...room,
        ...presence,
        updatedAt: new Date().toISOString(),
      });
      return getSnapshot(room)!;
    },
    leave(room: PdfCollaborationRoomRef, socketId: string) {
      return removeSocket(room, socketId);
    },
    clearSocket(socketId: string) {
      const removed: PdfCollaborationPresence[] = [];
      for (const state of rooms.values()) {
        const room = state.presenceBySocketId.get(socketId);
        if (!room) continue;
        const removedPresence = removeSocket(room, socketId);
        if (removedPresence) removed.push(removedPresence);
      }
      return removed;
    },
    updatePage(room: PdfCollaborationRoomRef, socketId: string, pageNumber: number) {
      const state = getRoom(room);
      const current = state?.presenceBySocketId.get(socketId);
      if (!state || !current) return null;

      const next = { ...current, pageNumber, updatedAt: new Date().toISOString() };
      state.presenceBySocketId.set(socketId, next);
      const pointer = state.pointersBySocketId.get(socketId);
      if (pointer) state.pointersBySocketId.set(socketId, { ...pointer, pageNumber, updatedAt: next.updatedAt });
      return next;
    },
    updatePointer(
      room: PdfCollaborationRoomRef,
      socketId: string,
      point: PdfCollaborationPoint & { pageNumber: number },
    ) {
      const state = getRoom(room);
      const current = state?.presenceBySocketId.get(socketId);
      if (!state || !current) return null;

      const pointer: PdfCollaborationPointer = {
        ...current,
        ...point,
        updatedAt: new Date().toISOString(),
      };
      state.pointersBySocketId.set(socketId, pointer);
      return pointer;
    },
    commitStroke(
      room: PdfCollaborationRoomRef,
      stroke: Omit<PdfCollaborationStroke, "color">,
    ) {
      const state = getOrCreateRoom(room);
      const strokes = state.strokesByPage.get(stroke.pageNumber) ?? new Map();
      const committed: PdfCollaborationStroke = {
        ...stroke,
        color: stroke.tool === "highlighter" ? "#facc15" : "#111827",
      };
      strokes.set(committed.id, committed);
      state.strokesByPage.set(committed.pageNumber, strokes);
      return committed;
    },
    removeStroke(room: PdfCollaborationRoomRef, pageNumber: number, strokeId: string) {
      const strokes = getRoom(room)?.strokesByPage.get(pageNumber);
      if (!strokes?.has(strokeId)) return false;
      strokes.delete(strokeId);
      if (strokes.size === 0) getRoom(room)?.strokesByPage.delete(pageNumber);
      return true;
    },
    clearPageStrokes(room: PdfCollaborationRoomRef, pageNumber: number) {
      const state = getRoom(room);
      if (!state) return false;
      state.strokesByPage.delete(pageNumber);
      return true;
    },
    getSnapshot,
  };
}
