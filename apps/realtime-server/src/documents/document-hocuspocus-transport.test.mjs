import assert from "node:assert/strict";
import test from "node:test";

import {
  createDocumentHocuspocusHooks,
} from "../../dist/documents/document-hocuspocus-transport.js";

test("forwards a crossws document connection through Hocuspocus lifecycle handlers", () => {
  const calls = [];
  const clientConnection = {
    handleClose(event) {
      calls.push({ type: "close", event });
    },
    handleMessage(message) {
      calls.push({ type: "message", message });
    },
  };
  const hooks = createDocumentHocuspocusHooks({
    handleConnection(websocket, request) {
      calls.push({ type: "open", request, websocket });
      return clientConnection;
    },
  });
  const peer = {
    request: new Request("http://realtime.local/sync/documents"),
    websocket: { readyState: 1 },
  };
  const message = new Uint8Array([1, 2, 3]);

  hooks.open(peer);
  hooks.message(peer, { uint8Array: () => message });
  hooks.close(peer, { code: 1000, reason: "normal" });

  assert.deepEqual(calls, [
    { type: "open", request: peer.request, websocket: peer.websocket },
    { type: "message", message },
    { type: "close", event: { code: 1000, reason: "normal" } },
  ]);
});

test("does not forward messages after the peer is closed", () => {
  let handledMessageCount = 0;
  const hooks = createDocumentHocuspocusHooks({
    handleConnection() {
      return {
        handleClose() {},
        handleMessage() {
          handledMessageCount += 1;
        },
      };
    },
  });
  const peer = {
    request: new Request("http://realtime.local/sync/documents"),
    websocket: { readyState: 1 },
  };

  hooks.open(peer);
  hooks.close(peer, { code: 1000, reason: "normal" });
  hooks.message(peer, { uint8Array: () => new Uint8Array([1]) });

  assert.equal(handledMessageCount, 0);
});
