import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import { loadRealtimeServerConfig } from "./config/realtime-config";
import { createRealtimeSocketServer } from "./socket/socket-server";

async function bootstrap() {
  const config = loadRealtimeServerConfig();
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
    httpServer: server,
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (url.pathname.startsWith("/socket.io/")) {
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

  websocketServer.on("connection", (websocket) => {
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
    void socketServer.close().finally(() => {
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
