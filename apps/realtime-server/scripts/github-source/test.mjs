import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";

const directory = new URL("../../src/github-source/", import.meta.url);
const [parserSource, accessSource, roomSource, handlersSource, fanOutSource, eventsSource, socketServerSource] =
  await Promise.all([
    readFile(new URL("github-source-payload.parser.ts", directory), "utf8"),
    readFile(new URL("github-source-access.service.ts", directory), "utf8"),
    readFile(new URL("github-source-room.service.ts", directory), "utf8"),
    readFile(new URL("github-source-socket-handlers.ts", directory), "utf8"),
    readFile(new URL("github-source-fan-out.ts", directory), "utf8"),
    readFile(new URL("github-source-socket-events.ts", directory), "utf8"),
    readFile(new URL("../../src/socket/socket-server.ts", import.meta.url), "utf8"),
  ]);

function load(source) {
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const { parseGithubSourceInvalidation, parseGithubSourceRoomRef } = await load(parserSource);
const workspaceId = "11111111-1111-4111-8111-111111111111";
const payload = {
  workspaceId,
  repositoryId: "22222222-2222-4222-8222-222222222222",
  sourceId: "33333333-3333-4333-8333-333333333333",
  sourceNumber: 24,
  sourceType: "pull_request",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

assert.deepEqual(parseGithubSourceRoomRef({ workspaceId }), { workspaceId });
assert.deepEqual(parseGithubSourceInvalidation(payload), payload);
assert.equal(parseGithubSourceInvalidation({ ...payload, sourceType: "repository" }), null);
assert.equal(parseGithubSourceInvalidation({ ...payload, sourceNumber: 0 }), null);
assert.equal(parseGithubSourceInvalidation({ ...payload, unknown: true }), null);

const { createGithubSourceAccessService } = await load(accessSource);
let accessQuery = null;
const accessService = createGithubSourceAccessService({
  async queryOne(text, values) {
    accessQuery = { text, values };
    return { workspace_id: workspaceId };
  },
});
assert.equal(await accessService.canJoinWorkspace({ userId: payload.sourceId }, workspaceId), true);
assert.match(accessQuery.text, /FROM workspace_members/);
assert.deepEqual(accessQuery.values, [workspaceId, payload.sourceId]);
assert.equal(await accessService.canJoinWorkspace({ userId: "invalid" }, workspaceId), false);

assert.match(roomSource, /`workspace:\$\{workspaceId\}:github-source`/);
assert.match(handlersSource, /canJoinWorkspace|roomService\.subscribe/);
assert.match(handlersSource, /githubSourceClientEvents\.subscribe/);
assert.match(fanOutSource, /parseGithubSourceInvalidation/);
assert.match(fanOutSource, /githubSourceServerEvents\.invalidated/);
assert.match(eventsSource, /github:source:subscribe/);
assert.match(eventsSource, /github:source:invalidated/);
assert.match(socketServerSource, /GITHUB_SOURCE_INVALIDATION_REDIS_CHANNEL = "github:source-invalidations"/);
assert.match(socketServerSource, /registerGithubSourceSocketHandlers/);
assert.match(socketServerSource, /unsubscribeGithubSourceInvalidations/);

console.log("GitHub source realtime tests passed");
