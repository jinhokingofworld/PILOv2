import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./api/client.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { createGithubIntegrationApiClient } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const calls = [];
const client = createGithubIntegrationApiClient({
  accessToken: "access-token",
  baseUrl: "https://api.example.test",
  fetcher: async (url, init) => {
    calls.push({ url, init });
    return Response.json({
      success: true,
      data: { id: "sync-run-1", target: "source", status: "queued" }
    }, { status: 202 });
  }
});

const body = { installationId: "installation-1", target: "source" };
const result = await client.startGithubSyncRun("workspace-1", body, "retry-key-1");

assert.equal(result.id, "sync-run-1");
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://api.example.test/api/v1/workspaces/workspace-1/github/sync-runs");
assert.equal(calls[0].init.method, "POST");
assert.equal(new Headers(calls[0].init.headers).get("Idempotency-Key"), "retry-key-1");
assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer access-token");
assert.deepEqual(JSON.parse(calls[0].init.body), body);
assert.equal(JSON.parse(calls[0].init.body).idempotencyKey, undefined);

console.log("github manual-sync execution tests passed");
