"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSync } from "@tldraw/sync";
import {
  getSnapshot,
  inlineBase64AssetStore,
  type Editor,
  type TLEditorSnapshot,
} from "tldraw";
import { getStoredAuthSession } from "@/features/auth/session-storage";
import { CanvasWorkspaceLocationAdapter } from "@/features/canvas/canvas-workspace-location-adapter";
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
  const syncConfig = useMemo(
    () =>
      createCanvasTldrawSyncConfig({
        canvasId: board.id,
        workspaceId: board.workspaceId,
      }),
    [board.id, board.workspaceId],
  );

  if (syncConfig) {
    return (
      <PiloTldrawRemoteSyncRuntime
        board={board}
        onHistoryStateChange={onHistoryStateChange}
        onReady={onReady}
        syncUri={syncConfig.syncUri}
      />
    );
  }

  return (
    <PiloTldrawSnapshotFallbackRuntime
      board={board}
      canvasClient={canvasClient}
      onHistoryStateChange={onHistoryStateChange}
      onReady={onReady}
    />
  );
}

function PiloTldrawRemoteSyncRuntime({
  board,
  onHistoryStateChange,
  onReady,
  syncUri,
}: {
  board: CanvasBoardDetail;
  onHistoryStateChange: (state: PiloCanvasHistoryState) => void;
  onReady: (actions: PiloCanvasActions | null) => void;
  syncUri: string;
}) {
  const syncStore = useSync({
    assets: inlineBase64AssetStore,
    uri: syncUri,
  });

  const mountEditor = useCallback(
    (_editor: Editor) => {
      onReady(null);
      onHistoryStateChange({ canRedo: false, canUndo: false });
    },
    [onHistoryStateChange, onReady],
  );

  return (
    <div className="pilo-tldraw-sync-runtime">
      {syncStore.status === "synced-remote" ? (
        <TldrawSurface
          key={`${board.workspaceId}:${board.id}:tldraw-sync:remote`}
          className="pilo-tldraw-canvas"
          hideUi={false}
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
          onMount={mountEditor}
          store={syncStore.store}
        >
          <CanvasWorkspaceLocationAdapter canvasId={board.id} />
        </TldrawSurface>
      ) : (
        <div className="pilo-tldraw-sync-runtime__loading" />
      )}
      <div className="pilo-tldraw-sync-runtime__notice">
        <strong>{board.title}</strong>
        <span>{getRemoteSyncStateMessage(syncStore)}</span>
      </div>
    </div>
  );
}

function PiloTldrawSnapshotFallbackRuntime({
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
      >
        <CanvasWorkspaceLocationAdapter canvasId={board.id} />
      </TldrawSurface>
      <div className="pilo-tldraw-sync-runtime__notice">
        <strong>{board.title}</strong>
        <span>{getSnapshotFallbackStateMessage(syncState)}</span>
      </div>
    </div>
  );
}

function createCanvasTldrawSyncConfig({
  canvasId,
  workspaceId,
}: {
  canvasId: string;
  workspaceId: string;
}) {
  const realtimeServerUrl =
    process.env.NEXT_PUBLIC_PILO_REALTIME_SERVER_URL?.trim();
  const accessToken = getStoredAuthSession()?.accessToken;

  if (!realtimeServerUrl || !accessToken) {
    return null;
  }

  return {
    syncUri: createCanvasTldrawSyncUri({
      accessToken,
      canvasId,
      realtimeServerUrl,
      workspaceId,
    }),
  };
}

function createCanvasTldrawSyncUri({
  accessToken,
  canvasId,
  realtimeServerUrl,
  workspaceId,
}: {
  accessToken: string;
  canvasId: string;
  realtimeServerUrl: string;
  workspaceId: string;
}) {
  const url = new URL("/sync/canvas", realtimeServerUrl);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("canvasId", canvasId);
  url.searchParams.set("accessToken", accessToken);

  return url.toString();
}

function getRemoteSyncStateMessage(
  syncStore: ReturnType<typeof useSync>,
) {
  switch (syncStore.status) {
    case "loading":
      return "tldraw sync 서버에 연결하는 중입니다.";
    case "error":
      return `tldraw sync 연결 중 오류가 발생했습니다. ${syncStore.error.message}`;
    case "synced-remote":
    default:
      return "이 Canvas는 tldraw sync 서버로 실시간 동기화됩니다.";
  }
}

function getSnapshotFallbackStateMessage(syncState: SyncState) {
  switch (syncState) {
    case "loading":
      return "tldraw sync 문서를 불러오는 중입니다.";
    case "saving":
      return "tldraw sync 문서를 저장하는 중입니다.";
    case "error":
      return "tldraw sync 문서 저장/복원 중 오류가 발생했습니다.";
    case "ready":
    default:
      return "realtime server URL이 없어 snapshot 저장/복원 fallback으로 동작합니다.";
  }
}
