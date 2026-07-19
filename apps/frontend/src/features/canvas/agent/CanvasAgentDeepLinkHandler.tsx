"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEditor, type TLShapeId } from "tldraw";

import { createCanvasAgentClient } from "../api/canvas-agent-client";
import type { CanvasDriveFileReference } from "../integrations/drive/canvas-drive-file";
import { isCanvasDrivePreviewMimeType } from "../integrations/drive/canvas-drive-file";
import { createCanvasDrivePreviewUrl } from "../integrations/drive/canvas-drive-client";
import { focusCanvasAgentResult } from "./canvas-agent-camera";
import {
  CANVAS_AGENT_RUN_QUERY_KEY,
  getCanvasAgentDriveShapeId,
  readCanvasAgentDeepLinkRunId,
} from "./canvas-agent-deep-link";

const FOCUS_RETRY_DELAYS_MS = [700, 1_400, 2_800] as const;

export function CanvasAgentDeepLinkHandler({
  canvasId,
  onDriveFileInsert,
  workspaceId,
}: {
  canvasId: string;
  onDriveFileInsert: (
    file: CanvasDriveFileReference,
    runId: string,
  ) => boolean;
  workspaceId: string;
}) {
  const editor = useEditor();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const runId = useMemo(
    () => readCanvasAgentDeepLinkRunId(new URLSearchParams(search), canvasId),
    [canvasId, search],
  );
  const handledRunKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const deepLinkRunId = runId;
    const runKey = `${canvasId}:${deepLinkRunId}`;
    if (handledRunKeyRef.current === runKey) return;
    handledRunKeyRef.current = runKey;

    const abortController = new AbortController();
    let retryTimer: number | null = null;
    const client = createCanvasAgentClient();

    function finish() {
      const nextSearchParams = new URLSearchParams(search);
      nextSearchParams.delete(CANVAS_AGENT_RUN_QUERY_KEY);
      const nextSearch = nextSearchParams.toString();
      router.replace(`/canvas${nextSearch ? `?${nextSearch}` : ""}`, {
        scroll: false,
      });
    }

    function focusLoadedShapes(shapeIds: string[]) {
      const loadedShapeIds = shapeIds.filter((shapeId) =>
        editor.getShape(shapeId as TLShapeId),
      );
      if (!loadedShapeIds.length) return false;
      editor.setSelectedShapes(loadedShapeIds as TLShapeId[]);
      return focusCanvasAgentResult(editor, loadedShapeIds, null);
    }

    function retryShapeFocus(shapeIds: string[], attempt = 0) {
      if (abortController.signal.aborted) return;
      if (focusLoadedShapes(shapeIds) || attempt >= FOCUS_RETRY_DELAYS_MS.length) {
        finish();
        return;
      }
      retryTimer = window.setTimeout(
        () => retryShapeFocus(shapeIds, attempt + 1),
        FOCUS_RETRY_DELAYS_MS[attempt],
      );
    }

    async function handleDeepLink() {
      try {
        const detail = await client.getRun(
          workspaceId,
          canvasId,
          deepLinkRunId,
        );
        if (abortController.signal.aborted) return;
        const run = detail.run;
        if (
          run.id !== deepLinkRunId ||
          run.workspaceId !== workspaceId ||
          run.canvasId !== canvasId ||
          run.status !== "completed"
        ) {
          return;
        }

        if (run.clientAction?.type === "insert_drive_file") {
          const accessToken = window.localStorage.getItem("pilo:access-token");
          if (!accessToken) return;
          const preview = await createCanvasDrivePreviewUrl({
            accessToken,
            fileId: run.clientAction.file.fileId,
            signal: abortController.signal,
            workspaceId,
          });
          if (
            abortController.signal.aborted ||
            preview.file.id !== run.clientAction.file.fileId ||
            preview.file.itemType !== "file" ||
            preview.file.uploadStatus !== "ready" ||
            !preview.file.mimeType ||
            !isCanvasDrivePreviewMimeType(preview.file.mimeType)
          ) {
            return;
          }
          const inserted = onDriveFileInsert(
            {
              fileId: preview.file.id,
              fileName: preview.file.name,
              mimeType: preview.file.mimeType,
            },
            deepLinkRunId,
          );
          if (!inserted) return;
          const shapeId = getCanvasAgentDriveShapeId(deepLinkRunId) as TLShapeId;
          editor.setSelectedShapes([shapeId]);
          focusCanvasAgentResult(editor, [shapeId], null);
          finish();
          return;
        }

        const highlightedShapeIds = run.progress?.highlightedShapeIds ?? [];
        const targetViewport = run.progress?.targetViewport ?? null;
        if (!highlightedShapeIds.length && !targetViewport) {
          finish();
          return;
        }

        if (targetViewport) {
          focusCanvasAgentResult(editor, [], targetViewport);
        }
        if (!highlightedShapeIds.length) {
          finish();
          return;
        }
        retryShapeFocus(highlightedShapeIds);
      } catch {
        // Preserve the query so an explicit reload can retry a transient failure.
      }
    }

    void handleDeepLink();
    return () => {
      abortController.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [canvasId, editor, onDriveFileInsert, router, runId, search, workspaceId]);

  return null;
}
