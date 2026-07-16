import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import { createRealtimeSessionService } from "./auth/session.service";
import { createCanvasTldrawSyncRoomService } from "./canvas/canvas-tldraw-sync-room.service";
import { loadRealtimeServerConfig } from "./config/realtime-config";
import { createRealtimeDatabase } from "./database/database";
import { createDocumentAccessService } from "./documents/document-access.service";
import { createDocumentHocuspocusService } from "./documents/document-hocuspocus.service";
import { createDocumentHocuspocusTransport } from "./documents/document-hocuspocus-transport";
import { createRealtimeSocketServer } from "./socket/socket-server";

async function bootstrap() {
  const config = loadRealtimeServerConfig();
  const database = createRealtimeDatabase({
    databaseApplicationName: config.databaseApplicationName,
    databasePoolConnectionTimeoutMs: config.databasePoolConnectionTimeoutMs,
    databasePoolIdleTimeoutMs: config.databasePoolIdleTimeoutMs,
    databasePoolMax: config.databasePoolMax,
    databaseSsl: config.databaseSsl,
    databaseUrl: config.databaseUrl,
  });
  const server = createServer((request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (url.pathname === "/health" || url.pathname === "/sync/health") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          service: "pilo-realtime-server",
          status: "ok",
          scope: config.scope,
          classic: {
            canvas: {
              engine: "classic_room_state",
              ...socketServer.getCanvasRoomStateStats(),
            },
          },
          sync: {
            canvas: {
              endpoint: "/sync/canvas",
              engine: "tldraw_sync",
              ...tldrawSyncRoomService.getStats(),
            },
            documents: {
              endpoint: "/sync/documents",
              engine: "hocuspocus",
              activeSessionCount: documentHocuspocus.getConnectionsCount(),
              roomCount: documentHocuspocus.getDocumentsCount(),
            },
          },
        }),
      );
      return;
    }

    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  const socketServer = await createRealtimeSocketServer({
    config,
    database,
    httpServer: server,
  });
  const tldrawSyncRoomService = createCanvasTldrawSyncRoomService({
    database,
  });
  const documentHocuspocusService = createDocumentHocuspocusService({
    accessService: createDocumentAccessService({ database }),
    sessionService: createRealtimeSessionService(database),
  });
  const documentHocuspocus = documentHocuspocusService.hocuspocus;
  const documentHocuspocusTransport = await createDocumentHocuspocusTransport(
    documentHocuspocus,
  );
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (url.pathname.startsWith("/socket.io/")) {
      return;
    }

    if (url.pathname === "/sync/documents") {
      void documentHocuspocusTransport
        .handleUpgrade(request, socket, head)
        .catch((error) => {
          console.error("Document Hocuspocus connection failed", error);
          socket.destroy();
        });
      return;
    }

    const acceptsRealtimePath =
      url.pathname === "/ws" ||
      url.pathname.startsWith("/ws/") ||
      url.pathname.startsWith("/sync/");

    if (!acceptsRealtimePath) {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (websocket, request) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (url.pathname === "/sync/canvas") {
      void tldrawSyncRoomService
        .handleConnection(websocket, request)
        .catch((error) => {
          console.error("Canvas tldraw sync connection failed", error);
          websocket.close(1011, "INTERNAL_ERROR");
        });
      return;
    }

    websocket.send(
      JSON.stringify({
        type: "ready",
        service: "pilo-realtime-server",
        scope: config.scope,
      }),
    );

    websocket.on("message", (message) => {
      const text = message.toString();
      websocket.send(
        JSON.stringify({
          type: text === "ping" ? "pong" : "ack",
          received: text,
        }),
      );
    });
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`PILO realtime server listening on ${config.port}`);
  });

  function shutdown() {
    documentHocuspocus.closeConnections();
    void tldrawSyncRoomService
      .close()
      .finally(() => socketServer.close())
      .finally(() => {
        server.close(() => process.exit(0));
      });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void bootstrap().catch((error) => {
  console.error("Failed to start PILO realtime server", error);
  process.exit(1);
});
