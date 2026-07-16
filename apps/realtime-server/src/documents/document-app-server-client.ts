import type { DocumentRoomRef } from "./document-types";

type DocumentSnapshot = {
  contentJson?: Record<string, unknown>;
  yjsState: string;
};

export type DocumentBootstrap = {
  document: { currentVersion: number };
  snapshot: DocumentSnapshot;
};

export type DocumentSnapshotSaveResult = {
  document: { currentVersion: number };
};

export type SaveDocumentSnapshotInput = DocumentRoomRef & {
  accessToken: string;
  contentJson: Record<string, unknown>;
  expectedVersion: number;
  yjsState: string;
};

export class DocumentCheckpointError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DocumentCheckpointError";
  }
}

export type DocumentAppServerClient = {
  getDocument: (input: DocumentRoomRef & { accessToken: string }) => Promise<DocumentBootstrap>;
  saveDocumentSnapshot: (
    input: SaveDocumentSnapshotInput,
  ) => Promise<DocumentSnapshotSaveResult>;
};

export function createDocumentAppServerClient({
  appServerUrl,
  fetcher = fetch,
}: {
  appServerUrl: string;
  fetcher?: typeof fetch;
}): DocumentAppServerClient {
  function pathFor(room: DocumentRoomRef) {
    const workspaceId = encodeURIComponent(room.workspaceId);
    const documentId = encodeURIComponent(room.documentId);
    return `${appServerUrl}/workspaces/${workspaceId}/drive/documents/${documentId}`;
  }

  async function request<T>(
    input: DocumentRoomRef & { accessToken: string },
    init?: RequestInit,
    pathSuffix = "",
  ): Promise<T> {
    const response = await fetcher(`${pathFor(input)}${pathSuffix}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const payload = await readJson(response);

    if (!response.ok) {
      throw new DocumentCheckpointError(
        response.status,
        readErrorMessage(payload) ?? "Drive API request failed",
      );
    }

    return unwrapSuccessPayload<T>(payload);
  }

  return {
    getDocument(input) {
      return request<DocumentBootstrap>(input);
    },
    saveDocumentSnapshot(input) {
      return request<DocumentSnapshotSaveResult>(input, {
        body: JSON.stringify({
          contentJson: input.contentJson,
          expectedVersion: input.expectedVersion,
          yjsState: input.yjsState,
        }),
        method: "PUT",
      }, "/snapshot");
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DocumentCheckpointError(response.status, "Drive API returned invalid JSON");
  }
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) {
    return null;
  }

  return typeof payload.error.message === "string" ? payload.error.message : null;
}

function unwrapSuccessPayload<T>(payload: unknown): T {
  if (isRecord(payload) && payload.success === true && "data" in payload) {
    return payload.data as T;
  }

  throw new DocumentCheckpointError(502, "Drive API returned an unexpected response");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
