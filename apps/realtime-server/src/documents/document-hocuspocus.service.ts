import { createRequire } from "node:module";

import type { RealtimeSessionService } from "../auth/session.service";
import type { DocumentAccessService } from "./document-access.service";
import type { DocumentHocuspocusInstance } from "./document-hocuspocus-transport";
import type { DocumentRoomRef } from "./document-types";

type HocuspocusDocumentServer = DocumentHocuspocusInstance & {
  closeConnections: () => void;
  getConnectionsCount: () => number;
  getDocumentsCount: () => number;
};

type HocuspocusConstructor = new <Context>(configuration: {
  onAuthenticate: (payload: {
    documentName: string;
    token: string;
  }) => Promise<Context>;
  unloadImmediately: boolean;
}) => HocuspocusDocumentServer;

const { Hocuspocus } = createRequire(__filename)("@hocuspocus/server") as {
  Hocuspocus: HocuspocusConstructor;
};

export type DocumentHocuspocusContext = DocumentRoomRef & {
  userId: string;
};

export type DocumentHocuspocusService = {
  authorizeDocument: (
    documentName: string,
    token: string,
  ) => Promise<DocumentHocuspocusContext>;
  hocuspocus: HocuspocusDocumentServer;
};

export function createDocumentHocuspocusService({
  accessService,
  sessionService,
}: {
  accessService: DocumentAccessService;
  sessionService: RealtimeSessionService;
}): DocumentHocuspocusService {
  async function authorizeDocument(documentName: string, token: string) {
    const room = parseDocumentRoomName(documentName);
    if (!room) {
      throw new Error("FORBIDDEN");
    }

    const session = await sessionService.validateSessionToken(token);
    if (!session) {
      throw new Error("NOT_AUTHENTICATED");
    }

    const access = await accessService.getDocumentRoomAccess(
      { userId: session.userId },
      room,
    );
    if (!access) {
      throw new Error("FORBIDDEN");
    }

    return { ...room, userId: session.userId };
  }

  const hocuspocus = new Hocuspocus<DocumentHocuspocusContext>({
    async onAuthenticate({ documentName, token }) {
      return authorizeDocument(documentName, token);
    },
    unloadImmediately: true,
  });

  return { authorizeDocument, hocuspocus };
}

function parseDocumentRoomName(documentName: string): DocumentRoomRef | null {
  const parts = documentName.split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== "workspace" ||
    parts[2] !== "document" ||
    parts[4] !== "yjs" ||
    !parts[1] ||
    !parts[3]
  ) {
    return null;
  }

  return { documentId: parts[3], workspaceId: parts[1] };
}
