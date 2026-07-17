import { createRequire } from "node:module";

import {
  DocumentCheckpointError,
  type DocumentAppServerClient,
} from "./document-app-server-client";
import type { DocumentRoomRef } from "./document-types";

export { DocumentCheckpointError } from "./document-app-server-client";

const moduleRequire = createRequire(__filename);
const Y = moduleRequire("yjs") as {
  applyUpdate: (
    document: YDocument,
    update: Uint8Array,
    origin?: { skipStoreHooks: boolean; source: "local" },
  ) => void;
  encodeStateAsUpdate: (document: YDocument) => Uint8Array;
};
const { yXmlFragmentToProsemirrorJSON } = moduleRequire("y-prosemirror") as {
  yXmlFragmentToProsemirrorJSON: (fragment: unknown) => Record<string, unknown>;
};

type YDocument = {
  getXmlFragment: (name: string) => unknown;
};

const checkpointMergeOrigin = { skipStoreHooks: true, source: "local" } as const;

type DocumentCheckpointContext = DocumentRoomRef & {
  accessToken: string;
};

type DocumentCheckpointStoreInput = DocumentCheckpointContext & {
  document: YDocument;
};

export type DocumentCheckpointService = {
  loadDocument: (input: DocumentCheckpointContext) => Promise<Uint8Array>;
  storeDocument: (input: DocumentCheckpointStoreInput) => Promise<void>;
};

export function createDocumentCheckpointService({
  client,
}: {
  client: DocumentAppServerClient;
}): DocumentCheckpointService {
  const currentVersionByRoom = new Map<string, number>();

  async function loadDocument(input: DocumentCheckpointContext) {
    const bootstrap = await client.getDocument(input);
    currentVersionByRoom.set(roomKey(input), bootstrap.document.currentVersion);
    return Buffer.from(bootstrap.snapshot.yjsState, "base64");
  }

  async function storeDocument(input: DocumentCheckpointStoreInput) {
    const key = roomKey(input);
    const expectedVersion = currentVersionByRoom.get(key);

    if (expectedVersion === undefined) {
      throw new Error("Document checkpoint must load before store");
    }

    try {
      await save(input, expectedVersion);
      return;
    } catch (error) {
      if (!(error instanceof DocumentCheckpointError) || error.status !== 409) {
        throw error;
      }
    }

    const latest = await client.getDocument(input);
    Y.applyUpdate(
      input.document,
      Buffer.from(latest.snapshot.yjsState, "base64"),
      checkpointMergeOrigin,
    );
    currentVersionByRoom.set(key, latest.document.currentVersion);
    await save(input, latest.document.currentVersion);
  }

  async function save(input: DocumentCheckpointStoreInput, expectedVersion: number) {
    const result = await client.saveDocumentSnapshot({
      ...input,
      contentJson: serializeContentJson(input.document),
      expectedVersion,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(input.document)).toString("base64"),
    });
    currentVersionByRoom.set(roomKey(input), result.document.currentVersion);
  }

  return { loadDocument, storeDocument };
}

function roomKey(room: DocumentRoomRef) {
  return `${room.workspaceId}:${room.documentId}`;
}

function serializeContentJson(document: YDocument): Record<string, unknown> {
  return yXmlFragmentToProsemirrorJSON(document.getXmlFragment("default"));
}
