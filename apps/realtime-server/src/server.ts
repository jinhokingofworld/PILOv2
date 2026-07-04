import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const scope = process.env.REALTIME_SCOPE ?? "notifications_status_only";

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname === "/health" || url.pathname === "/sync/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        service: "pilo-realtime-server",
        status: "ok",
        scope
      })
    );
    return;
  }

  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "not_found" }));
});

const websocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const acceptsRealtimePath =
    url.pathname === "/ws" ||
    url.pathname.startsWith("/socket.io/") ||
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
      scope
    })
  );

  websocket.on("message", (message) => {
    const text = message.toString();
    websocket.send(
      JSON.stringify({
        type: text === "ping" ? "pong" : "ack",
        received: text
      })
    );
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PILO realtime server listening on ${port}`);
});
