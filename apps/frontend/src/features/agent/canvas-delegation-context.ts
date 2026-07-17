"use client";

import type { AgentRunRequestContext } from "@/features/agent/types";
import type {
  CanvasAgentRun,
  CanvasAgentSelectedScene,
} from "@/features/canvas/api/canvas-agent-types";

export type CanvasAgentDelegationAdapter = {
  canvasId: string;
  buildRequestContext: (
    toolHelpMode: boolean,
  ) => Promise<AgentRunRequestContext>;
  presentRun: (
    run: CanvasAgentRun,
    selectedScene: CanvasAgentSelectedScene | null,
  ) => void;
};

let activeAdapter: CanvasAgentDelegationAdapter | null = null;
const listeners = new Set<() => void>();

export function registerCanvasAgentDelegationAdapter(
  adapter: CanvasAgentDelegationAdapter,
) {
  activeAdapter = adapter;
  emitChange();
  return () => {
    if (activeAdapter === adapter) {
      activeAdapter = null;
      emitChange();
    }
  };
}

export function getCanvasAgentDelegationAdapter() {
  return activeAdapter;
}

export function subscribeCanvasAgentDelegationAdapter(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}
