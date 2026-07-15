"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSnapshot,
  type Editor,
  type TLEditorSnapshot,
} from "tldraw";
import { TldrawSurface } from "@/shared/tldraw";
import type {
  CanvasBoardDetail,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import type {
  PiloCanvasActions,
  PiloCanvasHistoryState,
} from "../surface/PiloTldrawCanvas";

const SYNC_DOCUMENT_SAVE_DEBOUNCE_MS = 800;

type PiloTldrawSyncRuntimeProps = {
  board: CanvasBoardDetail;
  canvasClient?: CanvasViewSettingApiClient | null;
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
  onReady: (actions: PiloCanvasActions | null) => void;
};

type SyncState = "loading" | "ready" | "saving" | "error";

export function PiloTldrawSyncRuntime({
  board,
  canvasClient,
  onHistoryStateChange,
  onReady,
}: PiloTldrawSyncRuntimeProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("loading");

  const clearPersistTimer = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
  }, []);

  const persistSnapshot = useCallback(
    async (editor: Editor) => {
      if (!canvasClient?.updateSyncDocument) {
        return;
      }

      const snapshot = getSnapshot(editor.store) as unknown as Record<
        string,
        unknown
      >;

      setSyncState("saving");

      try {
        await canvasClient.updateSyncDocument(
          board.id,
          { snapshot },
          { workspaceId: board.workspaceId },
        );
        setSyncState("ready");
      } catch (error) {
        console.error("Canvas sync document save failed", error);
        setSyncState("error");
      }
    },
    [board.id, board.workspaceId, canvasClient],
  );

  const schedulePersistSnapshot = useCallback(
    (editor: Editor) => {
      clearPersistTimer();
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void persistSnapshot(editor);
      }, SYNC_DOCUMENT_SAVE_DEBOUNCE_MS);
    },
    [clearPersistTimer, persistSnapshot],
  );

  const mountEditor = useCallback(
    (editor: Editor) => {
      cleanupRef.current?.();
      onReady(null);
      onHistoryStateChange({ canRedo: false, canUndo: false });

      let disposed = false;
      let removeStoreListener: (() => void) | null = null;

      const start = async () => {
        setSyncState("loading");

        try {
          const document = await canvasClient?.getSyncDocument?.(board.id, {
            workspaceId: board.workspaceId,
          });

          if (disposed) {
            return;
          }

          if (document?.snapshot) {
            editor.loadSnapshot(
              document.snapshot as Partial<TLEditorSnapshot>,
              { forceOverwriteSessionState: true },
            );
          }

          setSyncState("ready");
        } catch (error) {
          console.error("Canvas sync document load failed", error);
          setSyncState("error");
        }

        if (disposed) {
          return;
        }

        removeStoreListener = editor.store.listen(
          () => schedulePersistSnapshot(editor),
          { scope: "document", source: "user" },
        );
      };

      void start();

      cleanupRef.current = () => {
        disposed = true;
        removeStoreListener?.();
        clearPersistTimer();
      };
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      clearPersistTimer,
      onHistoryStateChange,
      onReady,
      schedulePersistSnapshot,
    ],
  );

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return (
    <div className="pilo-tldraw-sync-runtime">
      <TldrawSurface
        key={`${board.workspaceId}:${board.id}:tldraw-sync`}
        className="pilo-tldraw-canvas"
        hideUi={false}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        onMount={mountEditor}
      />
      <div className="pilo-tldraw-sync-runtime__notice">
        <strong>{board.title}</strong>
        <span>{getSyncStateMessage(syncState)}</span>
      </div>
    </div>
  );
}

function getSyncStateMessage(syncState: SyncState) {
  switch (syncState) {
    case "loading":
      return "tldraw sync 문서를 불러오는 중입니다.";
    case "saving":
      return "tldraw sync 문서를 저장하는 중입니다.";
    case "error":
      return "tldraw sync 문서 저장/복원 중 오류가 발생했습니다.";
    case "ready":
    default:
      return "이 Canvas는 tldraw sync 타입입니다. 현재는 snapshot 저장/복원 fallback으로 동작합니다.";
  }
}
