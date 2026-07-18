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
const presentedRunKeys = new Set<string>();

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

export function presentCanvasAgentDelegationRunOnce({
  canvasId,
  run,
  selectedScene,
}: {
  canvasId: string;
  run: CanvasAgentRun;
  selectedScene: CanvasAgentSelectedScene | null;
}) {
  const adapter = activeAdapter;
  const runKey = `${canvasId}:${run.id}`;

  if (
    !adapter ||
    adapter.canvasId !== canvasId ||
    presentedRunKeys.has(runKey)
  ) {
    return false;
  }

  presentedRunKeys.add(runKey);
  try {
    adapter.presentRun(run, selectedScene);
    return true;
  } catch (error) {
    presentedRunKeys.delete(runKey);
    throw error;
  }
}

export function subscribeCanvasAgentDelegationAdapter(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}
