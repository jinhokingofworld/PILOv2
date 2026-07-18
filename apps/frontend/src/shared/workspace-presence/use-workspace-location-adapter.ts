"use client";

import { useEffect } from "react";

import { useWorkspacePresence } from "./workspace-presence-provider";
import type { WorkspaceLocationAdapter } from "./workspace-presence-types";

export function useWorkspaceLocationAdapter(adapter: WorkspaceLocationAdapter) {
  const {
    registerAdapter,
    reportLocationChange,
    reportManualInteraction,
  } = useWorkspacePresence();

  useEffect(() => registerAdapter(adapter), [adapter, registerAdapter]);

  return {
    reportInteraction: reportLocationChange,
    reportLocationChange,
    reportManualInteraction,
  };
}
