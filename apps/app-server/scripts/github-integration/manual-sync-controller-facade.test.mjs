import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GithubIntegrationController
} = require("../../dist/modules/github-integration/github-integration.controller.js");
const {
  GithubIntegrationService
} = require("../../dist/modules/github-integration/github-integration.service.js");

const calls = [];
const runService = {
  async startGithubSyncRun(...args) {
    calls.push(args);
    return { id: "sync-run-1", status: "queued", target: "source" };
  }
};
const facade = {
  githubSyncRunService: runService
};
const controller = new GithubIntegrationController({
  startGithubSyncRun(...args) {
    return GithubIntegrationService.prototype.startGithubSyncRun.call(facade, ...args);
  }
});
const request = { installationId: "installation-1", target: "source" };

for (const idempotencyKey of [undefined, "", "\ninvalid"]) {
  await assert.rejects(
    () => controller.startGithubSyncRun("user-1", "workspace-1", request, idempotencyKey),
    (error) => error.getStatus() === 400
  );
}
assert.deepEqual(calls, []);

const response = await controller.startGithubSyncRun(
  "user-1",
  "workspace-1",
  request,
  "retry-key-1"
);
assert.deepEqual(response, {
  success: true,
  data: { id: "sync-run-1", status: "queued", target: "source" }
});
assert.deepEqual(calls, [[
  "user-1",
  "workspace-1",
  request,
  "manual",
  "retry-key-1"
]]);

console.log("GitHub manual-sync controller/facade tests passed");
