"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import type { CanvasRemoteShapePreviewStore } from "./canvas-remote-shape-preview-store";

const CanvasRemoteShapePreviewContext =
  createContext<CanvasRemoteShapePreviewStore | null>(null);

export function CanvasRemoteShapePreviewProvider({
  children,
  previewStore,
}: {
  children: ReactNode;
  previewStore: CanvasRemoteShapePreviewStore | null;
}) {
  return (
    <CanvasRemoteShapePreviewContext.Provider value={previewStore}>
      {children}
    </CanvasRemoteShapePreviewContext.Provider>
  );
}

export function useCanvasRemoteShapePreviewStore() {
  return useContext(CanvasRemoteShapePreviewContext);
}
