type CanvasAgentFocusableProgress = {
  highlightedShapeIds: string[];
  loadRootShapeIds?: string[];
  message: string;
  targetViewport: unknown;
  toolTarget: string | null;
  toolTargetLabel: string | null;
};

export function completeCanvasAgentFocusProgress<
  TProgress extends CanvasAgentFocusableProgress,
>(progress: TProgress, message: string) {
  return {
    ...progress,
    highlightedShapeIds: [],
    loadRootShapeIds: [],
    message,
    targetViewport: null,
    toolTarget: null,
    toolTargetLabel: null,
  };
}
