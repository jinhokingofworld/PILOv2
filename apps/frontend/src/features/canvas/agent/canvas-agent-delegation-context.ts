import type { Editor } from "tldraw";
import type { AgentRunRequestContext } from "@/features/agent/types";
import { buildCanvasAgentSelectedScene, CanvasAgentSelectedSceneError } from "./canvas-agent-selected-scene";
import { buildCanvasAgentShapeSummaries } from "./canvas-agent-shape-context";

export async function buildCanvasAgentDelegationRequestContext({
  canvasId,
  editor,
  onFrameSubtreeRequest,
  toolHelpMode,
}: {
  canvasId: string;
  editor: Editor;
  onFrameSubtreeRequest?: (frameId: string) => Promise<void> | void;
  toolHelpMode: boolean;
}): Promise<AgentRunRequestContext> {
  let selectedScene = null;
  let selectedSceneError: string | null = null;
  try {
    selectedScene = buildCanvasAgentSelectedScene(editor);
  } catch (error) {
    if (
      error instanceof CanvasAgentSelectedSceneError &&
      error.missingFrameIds.length > 0 &&
      onFrameSubtreeRequest
    ) {
      try {
        await Promise.all(
          error.missingFrameIds.map((frameId) => onFrameSubtreeRequest(frameId)),
        );
        await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
        selectedScene = buildCanvasAgentSelectedScene(editor);
      } catch (hydrationError) {
        selectedSceneError = hydrationError instanceof CanvasAgentSelectedSceneError
          ? hydrationError.message
          : "선택 영역을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      }
    } else {
      selectedSceneError = error instanceof CanvasAgentSelectedSceneError
        ? error.message
        : "선택 영역을 코드 생성용으로 읽지 못했습니다.";
    }
  }

  const viewport = editor.getViewportPageBounds();
  const selectedShapeIds = editor.getSelectedShapeIds().map(String);
  const shapeSummaries = buildCanvasAgentShapeSummaries(editor);
  return {
    surface: "canvas",
    canvasId,
    canvasContext: {
      presentationMode: "interactive",
      selectedShapeIds,
      selectedScene: selectedScene as Record<string, unknown> | null,
      selectedSceneError,
      shapeSummaries: selectedShapeIds.length
        ? shapeSummaries.slice(0, 20)
        : shapeSummaries,
      toolHelpMode,
      viewport: {
        x: viewport.x,
        y: viewport.y,
        width: viewport.w,
        height: viewport.h,
      },
    },
  };
}
