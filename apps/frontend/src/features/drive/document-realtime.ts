import { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";

const LOCAL_REALTIME_SERVER_URL = "ws://localhost:3001";
const DOCUMENT_SYNC_PATH = "/sync/documents";
const DOCUMENT_COLLABORATOR_COLORS = [
  "#0f766e",
  "#2563eb",
  "#b45309",
  "#be123c",
  "#7e22ce",
  "#047857"
];

export type DocumentRealtimeRoom = {
  documentId: string;
  workspaceId: string;
};

export type DocumentCollaborator = {
  color: string;
  name: string;
};

export function createDocumentCollaborator({
  displayName,
  userId
}: {
  displayName: string;
  userId: string;
}): DocumentCollaborator {
  const colorIndex = Array.from(userId).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0
  ) % DOCUMENT_COLLABORATOR_COLORS.length;

  return {
    color: DOCUMENT_COLLABORATOR_COLORS[colorIndex],
    name: displayName.trim() || "알 수 없는 사용자"
  };
}

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
