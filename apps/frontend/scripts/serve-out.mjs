import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const outDir = fileURLToPath(new URL("../out", import.meta.url));
const types = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"]
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(outDir, safePath);

  if (url.pathname.endsWith("/") || !extname(filePath)) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const file = await stat(filePath);
  response.writeHead(200, {
    "content-length": file.size,
    "content-type": types.get(extname(filePath)) ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PILO frontend static server listening on ${port}`);
});
