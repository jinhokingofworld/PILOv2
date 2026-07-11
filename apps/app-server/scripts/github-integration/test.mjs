import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appModule = await readFile(new URL("../../src/app.module.ts", import.meta.url), "utf8");
const moduleFile = await readFile(
  new URL("../../src/modules/github-integration/github-integration.module.ts", import.meta.url),
  "utf8"
);
const controllerFile = await readFile(
  new URL("../../src/modules/github-integration/github-integration.controller.ts", import.meta.url),
  "utf8"
);
const serviceFile = await readFile(
  new URL("../../src/modules/github-integration/github-integration.service.ts", import.meta.url),
  "utf8"
);
const typesIndex = await readFile(
  new URL("../../src/modules/github-integration/types/index.ts", import.meta.url),
  "utf8"
);
const dtoIndex = await readFile(
  new URL("../../src/modules/github-integration/dto/index.ts", import.meta.url),
  "utf8"
);
const envExample = await readFile(
  new URL("../../../../.env.example", import.meta.url),
  "utf8"
);
const githubIntegrationApi = await readFile(
  new URL("../../../../docs/api/github-integration-api.md", import.meta.url),
  "utf8"
);

const githubIntegrationDirectory = new URL(
  "../../src/modules/github-integration/",
  import.meta.url
);
const entries = await readdir(githubIntegrationDirectory, { withFileTypes: true });
const directoryNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

assert.match(appModule, /import \{ GithubIntegrationModule \}/);
assert.match(appModule, /imports: \[[^\]]*GithubIntegrationModule[^\]]*\]/);

assert.match(moduleFile, /imports: \[[\s\S]*DatabaseModule[\s\S]*WorkspaceModule[\s\S]*\]/);
assert.match(moduleFile, /controllers: \[GithubIntegrationController\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubIntegrationService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubAppClient[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubAppInstallationStateService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubReviewSubmissionService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubProjectV2WriteService[\s\S]*\]/);
assert.match(moduleFile, /exports: \[[\s\S]*GithubIntegrationService[\s\S]*\]/);
assert.match(moduleFile, /exports: \[[\s\S]*GithubProjectV2WriteService[\s\S]*\]/);

assert.match(controllerFile, /@Controller\(\)/);
assert.match(controllerFile, /constructor\(private readonly githubIntegrationService/);
assert.match(controllerFile, /@Get\("me\/github"\)/);
assert.match(controllerFile, /@Post\("me\/github\/oauth\/start"\)/);
assert.match(controllerFile, /@Get\("github\/oauth\/callback"\)/);
assert.match(controllerFile, /@Delete\("me\/github"\)/);
assert.match(controllerFile, /@Get\("me\/github\/project-oauth"\)/);
assert.match(controllerFile, /@Post\("me\/github\/project-oauth\/start"\)/);
assert.match(controllerFile, /@Get\("github\/project-oauth\/callback"\)/);
assert.match(controllerFile, /@Delete\("me\/github\/project-oauth"\)/);
assert.match(controllerFile, /@Post\("workspaces\/:workspaceId\/github\/installations\/start"\)/);
assert.match(controllerFile, /@Get\("github\/installations\/callback"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/installations"\)/);
assert.match(controllerFile, /@Delete\("workspaces\/:workspaceId\/github\/installations\/:installationId"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/repositories"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/repositories\/:repositoryId"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/projects-v2"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/projects-v2\/:projectV2Id"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/projects-v2\/:projectV2Id\/fields"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/projects-v2\/:projectV2Id\/status-options"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/projects-v2\/:projectV2Id\/kanban"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/projects-v2\/:projectV2Id\/items"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/issues\/:issueId"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/repositories\/:repositoryId\/pull-requests"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/pull-requests\/:pullRequestId"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/pull-requests\/:pullRequestId\/files"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/pull-requests\/:pullRequestId\/conflict-status"\)/);
assert.match(controllerFile, /@Post\("workspaces\/:workspaceId\/github\/sync-runs"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/sync-runs"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/sync-runs\/:syncRunId"\)/);
assert.match(controllerFile, /@UseGuards\(AuthGuard\)/);

assert.match(serviceFile, /getModuleInfo\(\): GitHubIntegrationModuleInfo/);
assert.match(serviceFile, /domain: "github-integration"/);
assert.match(serviceFile, /apiContract: "docs\/api\/github-integration-api\.md"/);
assert.match(serviceFile, /getGithubOAuthStatus/);
assert.match(serviceFile, /startGithubOAuth/);
assert.match(serviceFile, /completeGithubOAuthCallback/);
assert.match(serviceFile, /disconnectGithubOAuth/);
assert.match(serviceFile, /getGithubProjectOAuthStatus/);
assert.match(serviceFile, /startGithubProjectOAuth/);
assert.match(serviceFile, /completeGithubProjectOAuthCallback/);
assert.match(serviceFile, /disconnectGithubProjectOAuth/);
assert.match(serviceFile, /startGithubAppInstallation/);
assert.match(serviceFile, /completeGithubAppInstallationCallback/);
assert.match(serviceFile, /listGithubAppInstallations/);
assert.match(serviceFile, /deleteGithubAppInstallation/);
assert.match(serviceFile, /listGithubRepositories/);
assert.match(serviceFile, /getGithubRepository/);
assert.match(serviceFile, /listGithubProjectsV2/);
assert.match(serviceFile, /getGithubProjectV2/);
assert.match(serviceFile, /listGithubProjectV2Fields/);
assert.match(serviceFile, /listGithubProjectV2StatusOptions/);
assert.match(serviceFile, /getGithubProjectV2Kanban/);
assert.match(serviceFile, /listGithubProjectV2Items/);
assert.match(serviceFile, /getGithubIssue/);
assert.match(serviceFile, /listGithubPullRequests/);
assert.match(serviceFile, /getGithubPullRequest/);
assert.match(serviceFile, /listGithubPullRequestFiles/);
assert.match(serviceFile, /getGithubPullRequestConflictStatus/);
assert.match(serviceFile, /submitGithubPullRequestReview/);
assert.match(serviceFile, /startGithubSyncRun/);
assert.match(serviceFile, /listGithubSyncRuns/);
assert.match(serviceFile, /getGithubSyncRun/);

assert.match(typesIndex, /export type GitHubIntegrationModuleInfo/);
assert.match(typesIndex, /GithubPullRequestFilePayload/);
assert.match(typesIndex, /GithubPullRequestConflictStatusPayload/);
assert.match(typesIndex, /GithubPullRequestReviewSubmissionPayload/);
assert.match(typesIndex, /GithubAppInstallationDeletePayload/);
assert.match(typesIndex, /GithubProjectOAuthStatusPayload/);
assert.match(typesIndex, /GithubProjectOAuthStartPayload/);
assert.match(typesIndex, /GithubProjectOAuthCallbackPayload/);
assert.match(typesIndex, /GithubProjectOAuthDisconnectPayload/);
assert.match(typesIndex, /GithubSyncRunPayload/);
assert.match(typesIndex, /GithubSyncRunDetailPayload/);
assert.match(dtoIndex, /StartGithubSyncRunRequest/);
assert.match(dtoIndex, /ListGithubSyncRunsQuery/);
assert.match(envExample, /^API_PUBLIC_ORIGIN=/m);
assert.match(envExample, /^GITHUB_PROJECT_OAUTH_CLIENT_ID=/m);
assert.match(envExample, /^GITHUB_PROJECT_OAUTH_CLIENT_SECRET=/m);
assert.match(githubIntegrationApi, /GitHub account is already connected to another PILO account/);
assert.match(githubIntegrationApi, /409 CONFLICT/);
assert.match(githubIntegrationApi, /github_callback_error=invalid_state/);
assert.match(githubIntegrationApi, /github_callback_error=authorization_cancelled/);
assert.match(githubIntegrationApi, /github_callback_error=token_exchange_failed/);
assert.match(githubIntegrationApi, /github_callback_error=installation_not_accessible/);
assert.match(githubIntegrationApi, /github_oauth_error=account_already_connected/);
assert.match(githubIntegrationApi, /progressPercent/);
assert.match(githubIntegrationApi, /progressStage/);
assert.deepEqual(directoryNames.sort(), ["dto", "queries", "types"]);

const tscScript = fileURLToPath(
  new URL("../../node_modules/typescript/bin/tsc", import.meta.url)
);

await import("./structure.test.mjs");

execFileSync(process.execPath, [tscScript, "-p", "tsconfig.build.json"], {
  cwd: new URL("../..", import.meta.url),
  stdio: "inherit"
});

await import("./oauth.test.mjs");
await import("./installation.test.mjs");
await import("./github-app-client.test.mjs");
await import("./issue-assignees.test.mjs");
await import("./callback-redirect.test.mjs");
await import("./source-read.test.mjs");
await import("./project-v2.test.mjs");
await import("./pr-files.test.mjs");
await import("./review-submission.test.mjs");
await import("./conflict-merge.test.mjs");
await import("./sync-progress.test.mjs");
await import("./sync-runs.test.mjs");
await import("./async-sync-worker.test.mjs");
await import("./project-v2-write.test.mjs");
await import("./webhook.test.mjs");
