import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

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

const require = createRequire(import.meta.url);
const {
  GithubSyncExecutorService
} = require("../../dist/modules/github-integration/github-sync-executor.service.js");
const {
  GithubBoardInvalidationPublisherService
} = require("../../dist/modules/github-integration/github-board-invalidation-publisher.service.js");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectV2Id = "22222222-2222-4222-8222-222222222222";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-07-12T01:02:03.000Z";

function createHydrationContext() {
  return {
    currentUserId: "44444444-4444-4444-8444-444444444444",
    workspaceId,
    installation: {
      id: "55555555-5555-4555-8555-555555555555",
      workspace_id: workspaceId,
      github_installation_id: 1,
      account_login: "pilo",
      account_type: "Organization"
    },
    repository: null,
    projectV2: {
      id: projectV2Id,
      workspace_id: workspaceId,
      installation_id: "55555555-5555-4555-8555-555555555555",
      github_project_node_id: "PVT_kwDOExample"
    },
    githubUserAccessToken: null,
    config: {}
  };
}

function createHydrationDatabase() {
  const calls = [];

  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      assert.match(text, /FROM boards b/);
      assert.deepEqual(values, [workspaceId, projectV2Id]);
      return [{ project_v2_id: projectV2Id, repository_id: repositoryId }];
    },
    async queryOne(text, values) {
      calls.push({ text, values });

      if (/hydrate_pilo_board_from_github/.test(text)) {
        assert.deepEqual(values, [projectV2Id, repositoryId]);
        return { board_id: "42" };
      }

      if (/SELECT updated_at\s+FROM boards/.test(text)) {
        assert.deepEqual(values, [workspaceId, "42"]);
        return { updated_at: updatedAt };
      }

      assert.fail(`Unexpected query: ${text}`);
    }
  };
}

{
  const database = createHydrationDatabase();
  const published = [];
  const executor = new GithubSyncExecutorService(database, {}, {
    async publishInvalidation(payload) {
      published.push(payload);
    }
  });

  await executor.hydrateExistingBoardsForGithubProjectV2(
    createHydrationContext()
  );

  assert.deepEqual(published, [
    {
      workspaceId,
      boardId: "42",
      updatedAt
    }
  ]);
}

{
  const database = createHydrationDatabase();
  let publishAttempts = 0;
  const executor = new GithubSyncExecutorService(database, {}, {
    async publishInvalidation() {
      publishAttempts += 1;
      throw new Error("Redis unavailable");
    }
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await assert.doesNotReject(() =>
      executor.hydrateExistingBoardsForGithubProjectV2(createHydrationContext())
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(publishAttempts, 1);
  assert.equal(database.calls.length, 3);
}

assert.match(
  publisherSource,
  /BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations"/
);
assert.match(
  syncExecutorSource,
  /await this\.boardInvalidationPublisher\.publishInvalidation/
);
assert.match(
  syncExecutorSource,
  /private readonly boardInvalidationPublisher: GithubBoardInvalidationPublisherService/
);
assert.doesNotMatch(
  syncExecutorSource,
  /new GithubBoardInvalidationPublisherService\(\)/
);
assert.equal(
  Reflect.getMetadata("design:paramtypes", GithubSyncExecutorService)[2],
  GithubBoardInvalidationPublisherService
);
assert.match(syncExecutorSource, /updatedAt/);
assert.doesNotMatch(publisherSource, /raw/);
assert.match(integrationModuleSource, /GithubBoardInvalidationPublisherService/);
assert.match(workerModuleSource, /GithubBoardInvalidationPublisherService/);

console.log("board invalidation tests passed");
