import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleDirectory = new URL(
  "../../src/modules/github-integration/",
  import.meta.url
);

const [
  integrationModuleSource,
  workerModuleSource,
  publisherSource,
  syncExecutorSource
] = await Promise.all([
    readFile(new URL("github-integration.module.ts", moduleDirectory), "utf8"),
    readFile(new URL("github-sync-worker.module.ts", moduleDirectory), "utf8"),
    readFile(
      new URL("github-board-invalidation-publisher.service.ts", moduleDirectory),
      "utf8"
    ),
    readFile(new URL("github-sync-executor.service.ts", moduleDirectory), "utf8")
  ]);

assert.match(
  publisherSource,
  /BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations"/
);
assert.match(
  syncExecutorSource,
  /await this\.boardInvalidationPublisher\.publishInvalidation/
);
assert.match(syncExecutorSource, /updatedAt/);
assert.doesNotMatch(publisherSource, /raw/);
assert.match(integrationModuleSource, /GithubBoardInvalidationPublisherService/);
assert.match(workerModuleSource, /GithubBoardInvalidationPublisherService/);

console.log("board invalidation tests passed");
