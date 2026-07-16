import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";

export type DocumentHocuspocusClientConnection = {
  handleClose: (event: { code: number; reason: string }) => void;
  handleMessage: (message: Uint8Array) => void;
};

export type DocumentHocuspocusInstance = {
  handleConnection: (
    websocket: unknown,
    request: Request,
  ) => DocumentHocuspocusClientConnection;
};

type DocumentHocuspocusPeer = {
  request: Request;
  websocket: unknown;
};

type DocumentHocuspocusMessage = {
  uint8Array: () => Uint8Array;
};

type DocumentHocuspocusCloseEvent = {
  code: number;
  reason: string;
};

type DocumentHocuspocusHooks = {
  close: (
    peer: DocumentHocuspocusPeer,
    event: DocumentHocuspocusCloseEvent,
  ) => void;
  message: (
    peer: DocumentHocuspocusPeer,
    message: DocumentHocuspocusMessage,
  ) => void;
  open: (peer: DocumentHocuspocusPeer) => void;
};

type DocumentHocuspocusTransport = {
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => Promise<void>;
};

type CrosswsFactory = (options: {
  hooks: DocumentHocuspocusHooks;
}) => DocumentHocuspocusTransport;

export function createDocumentHocuspocusHooks(
  hocuspocus: DocumentHocuspocusInstance,
): DocumentHocuspocusHooks {
  const connections = new WeakMap<
    DocumentHocuspocusPeer,
    DocumentHocuspocusClientConnection
  >();

  return {
    open(peer) {
      connections.set(
        peer,
        hocuspocus.handleConnection(peer.websocket, peer.request),
      );
    },
    message(peer, message) {
      connections.get(peer)?.handleMessage(message.uint8Array());
    },
    close(peer, event) {
      connections.get(peer)?.handleClose({
        code: event.code,
        reason: event.reason,
      });
      connections.delete(peer);
    },
  };
}

export async function createDocumentHocuspocusTransport(
  hocuspocus: DocumentHocuspocusInstance,
): Promise<DocumentHocuspocusTransport> {
  const { default: createCrosswsAdapter } = (await import(
    "crossws/adapters/node"
  )) as { default: CrosswsFactory };

  return createCrosswsAdapter({
    hooks: createDocumentHocuspocusHooks(hocuspocus),
  });
}
