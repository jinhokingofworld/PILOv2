import { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";

const LOCAL_REALTIME_SERVER_URL = "ws://localhost:3001";
const DOCUMENT_SYNC_PATH = "/sync/documents";

export type DocumentRealtimeRoom = {
  documentId: string;
  workspaceId: string;
};

export function createDocumentRealtimeRoomName({
  documentId,
  workspaceId
}: DocumentRealtimeRoom) {
  return `workspace:${workspaceId}:document:${documentId}:yjs`;
}

export function getDocumentRealtimeServerUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_PILO_REALTIME_SERVER_URL?.trim();
  const realtimeServerUrl =
    configuredUrl ||
    (process.env.NODE_ENV === "production" ? null : LOCAL_REALTIME_SERVER_URL);

  if (!realtimeServerUrl) {
    return null;
  }

  return buildDocumentRealtimeServerUrl(realtimeServerUrl);
}

export function buildDocumentRealtimeServerUrl(realtimeServerUrl: string) {
  const url = new URL(realtimeServerUrl);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  }

  if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  url.pathname = DOCUMENT_SYNC_PATH;
  url.search = "";
  url.hash = "";

  return url.toString();
}

export function createDocumentRealtimeProvider({
  accessToken,
  document,
  onAuthenticationFailed,
  onStatusChange,
  room
}: {
  accessToken: string;
  document: Y.Doc;
  onAuthenticationFailed: (reason: string) => void;
  onStatusChange: (status: "connected" | "connecting" | "disconnected") => void;
  room: DocumentRealtimeRoom;
}) {
  const url = getDocumentRealtimeServerUrl();

  if (!url || !accessToken.trim()) {
    return null;
  }

  return new HocuspocusProvider({
    document,
    flushDelay: 100,
    name: createDocumentRealtimeRoomName(room),
    onAuthenticationFailed: ({ reason }) => onAuthenticationFailed(reason),
    onStatus: ({ status }) => onStatusChange(status),
    token: accessToken,
    url
  });
}

export function createDocumentSnapshotSaveQueue({
  delayMs,
  save
}: {
  delayMs: number;
  save: () => Promise<void>;
}) {
  let persistedRevision = 0;
  let queuedRevision = 0;
  let requestedRevision = 0;
  let saveQueue = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush() {
    clearTimer();

    const revision = requestedRevision;
    if (
      revision === 0 ||
      revision <= persistedRevision ||
      revision <= queuedRevision
    ) {
      return saveQueue;
    }

    queuedRevision = revision;
    const nextSave = saveQueue.then(async () => {
      try {
        await save();
        persistedRevision = Math.max(persistedRevision, revision);
      } catch (error) {
        if (queuedRevision === revision) {
          queuedRevision = persistedRevision;
        }
        throw error;
      }
    });
    saveQueue = nextSave.catch(() => undefined);
    return nextSave;
  }

  return {
    destroy() {
      clearTimer();
    },
    flush,
    schedule() {
      requestedRevision += 1;
      clearTimer();
      timer = setTimeout(() => {
        void flush().catch(() => undefined);
      }, delayMs);
    }
  };
}
