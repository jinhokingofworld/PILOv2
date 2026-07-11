"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { CanvasRemotePresenceState } from "./canvas-realtime-types";

const CanvasRemotePresenceContext = createContext<CanvasRemotePresenceState[]>(
  [],
);

export function CanvasRemotePresenceProvider({
  children,
  presence,
}: {
  children: ReactNode;
  presence: CanvasRemotePresenceState[];
}) {
  return (
    <CanvasRemotePresenceContext.Provider value={presence}>
      {children}
    </CanvasRemotePresenceContext.Provider>
  );
}

export function useCanvasRemoteShapePresence(shapeId: string) {
  const presence = useContext(CanvasRemotePresenceContext);

  return useMemo(
    () =>
      presence.filter((entry) =>
        entry.selectedShapeIds.some((selectedShapeId) => selectedShapeId === shapeId),
      ),
    [presence, shapeId],
  );
}

export function useCanvasRemoteShapeEditingPresence(shapeId: string) {
  const presence = useContext(CanvasRemotePresenceContext);

  return useMemo(
    () => presence.filter((entry) => entry.editingShapeId === shapeId),
    [presence, shapeId],
  );
}
