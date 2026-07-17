import assert from "node:assert/strict";
import { createServer } from "node:http";

import { inspectCorsPreflight } from "./cors-preflight-smoke.mjs";

const requests = [];
const server = createServer((request, response) => {
  requests.push({
    headers: request.headers,
    method: request.method,
    url: request.url
  });
  response.statusCode = 204;
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type"
  );
  response.setHeader("Access-Control-Allow-Credentials", "true");
  if (request.url === "/ok") {
    response.setHeader("Access-Control-Allow-Origin", "https://dev.pilo.my");
  }
  response.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const allowed = await inspectCorsPreflight({
    origin: "https://dev.pilo.my",
    requestHeaders: ["authorization", "content-type"],
    requestMethod: "POST",
    url: `${baseUrl}/ok`
  });

  assert.deepEqual(allowed, {
    allowCredentials: "true",
    allowHeaders: "authorization,content-type",
    allowMethods: "GET,POST,OPTIONS",
    allowOrigin: "https://dev.pilo.my",
    ok: true,
    status: 204
  });
  assert.equal(requests[0].method, "OPTIONS");
  assert.equal(requests[0].headers.origin, "https://dev.pilo.my");
  assert.equal(
    requests[0].headers["access-control-request-method"],
    "POST"
  );

  const missingOrigin = await inspectCorsPreflight({
    origin: "https://dev.pilo.my",
    requestHeaders: ["authorization", "content-type"],
    requestMethod: "POST",
    url: `${baseUrl}/missing-origin`
  });
  assert.equal(missingOrigin.ok, false);
  assert.equal(missingOrigin.allowOrigin, null);
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

console.log("Agent CORS preflight smoke tests passed.");
