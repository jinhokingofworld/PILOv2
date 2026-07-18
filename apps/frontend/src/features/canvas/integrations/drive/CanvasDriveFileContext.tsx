"use client";

import { createContext, useContext, type ReactNode } from "react";

const CanvasDriveWorkspaceContext = createContext("");

export function CanvasDriveFileProvider({
  children,
  workspaceId,
}: {
  children: ReactNode;
  workspaceId: string;
}) {
  return (
    <CanvasDriveWorkspaceContext.Provider value={workspaceId}>
      {children}
    </CanvasDriveWorkspaceContext.Provider>
  );
}

export function useCanvasDriveWorkspaceId() {
  return useContext(CanvasDriveWorkspaceContext);
}
