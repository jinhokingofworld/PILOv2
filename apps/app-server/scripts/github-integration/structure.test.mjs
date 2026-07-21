import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const moduleDirectory = new URL("../../src/modules/github-integration/", import.meta.url);
const moduleFile = await readFile(
  new URL("github-integration.module.ts", moduleDirectory),
  "utf8"
);
const serviceFile = await readFile(
  new URL("github-integration.service.ts", moduleDirectory),
  "utf8"
);
const pullRequestMergeServiceFile = await readFile(
  new URL("github-pull-request-merge.service.ts", moduleDirectory),
  "utf8"
);
const triggerSourceMigration = await readFile(
  new URL(
    "../../../../db/migrations/088_add_github_sync_run_trigger_source.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(triggerSourceMigration, /^BEGIN;[\s\S]*COMMIT;\s*$/i);
assert.match(triggerSourceMigration, /ADD COLUMN trigger_source TEXT/i);
assert.match(
  triggerSourceMigration,
  /SET trigger_source = 'legacy'[\s\S]*ALTER COLUMN trigger_source SET DEFAULT 'legacy'/i
);
assert.match(triggerSourceMigration, /ALTER COLUMN trigger_source SET NOT NULL/i);
assert.match(
  triggerSourceMigration,
  /CHECK \(trigger_source IN \('manual', 'automatic', 'legacy'\)\)/i
);
assert.match(
  triggerSourceMigration,
  /\(workspace_id, trigger_source, started_at DESC, id DESC\)/i
);
const compactServiceFile = serviceFile.replace(/\s+/g, "");
const entries = await readdir(moduleDirectory, { withFileTypes: true });
const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

const featureServices = [
  {
    fileName: "github-oauth-integration.service.ts",
    className: "GithubOAuthIntegrationService"
  },
  {
    fileName: "github-project-oauth-integration.service.ts",
    className: "GithubProjectOAuthIntegrationService"
  },
  {
    fileName: "github-app-installation.service.ts",
    className: "GithubAppInstallationService"
  },
  {
    fileName: "github-callback-state.service.ts",
    className: "GithubCallbackStateService"
  },
  {
    fileName: "github-source-read.service.ts",
    className: "GithubSourceReadService"
  },
  {
    fileName: "github-project-v2.service.ts",
    className: "GithubProjectV2Service"
  },
  {
    fileName: "github-pull-request-remote.service.ts",
    className: "GithubPullRequestRemoteService"
  },
  {
    fileName: "github-pull-request-merge.service.ts",
    className: "GithubPullRequestMergeService"
  },
  {
    fileName: "github-webhook.service.ts",
    className: "GithubWebhookService"
  },
  {
    fileName: "github-sync-run.service.ts",
    className: "GithubSyncRunService"
  },
  {
    fileName: "github-sync-executor.service.ts",
    className: "GithubSyncExecutorService"
  }
];

for (const { fileName, className } of featureServices) {
  const importPath = `./${fileName.replace(/\.ts$/, "")}`;

  assert.ok(
    fileNames.includes(fileName),
    `${fileName} must exist so github-integration service responsibilities stay split by issue area.`
  );
  assert.match(moduleFile, new RegExp(`import \\{ ${className} \\} from "${importPath}";`));
  assert.match(moduleFile, new RegExp(`providers: \\[[\\s\\S]*${className}[\\s\\S]*\\]`));
}

const delegatedMethods = [
  {
    methodName: "getGithubOAuthStatus",
    serviceName: "githubOAuthIntegrationService",
    args: "currentUserId"
  },
  {
    methodName: "startGithubOAuth",
    serviceName: "githubOAuthIntegrationService",
    args: "currentUserId, input"
  },
  {
    methodName: "completeGithubOAuthCallback",
    serviceName: "githubOAuthIntegrationService",
    args: "query, cookieHeader"
  },
  {
    methodName: "disconnectGithubOAuth",
    serviceName: "githubOAuthIntegrationService",
    args: "currentUserId"
  },
  {
    methodName: "getGithubProjectOAuthStatus",
    serviceName: "githubProjectOAuthIntegrationService",
    args: "currentUserId"
  },
  {
    methodName: "startGithubProjectOAuth",
    serviceName: "githubProjectOAuthIntegrationService",
    args: "currentUserId, input"
  },
  {
    methodName: "completeGithubProjectOAuthCallback",
    serviceName: "githubProjectOAuthIntegrationService",
    args: "query, cookieHeader"
  },
  {
    methodName: "disconnectGithubProjectOAuth",
    serviceName: "githubProjectOAuthIntegrationService",
    args: "currentUserId"
  },
  {
    methodName: "startGithubAppInstallation",
    serviceName: "githubAppInstallationService",
    args: "currentUserId, workspaceId, input"
  },
  {
    methodName: "completeGithubAppInstallationCallback",
    serviceName: "githubAppInstallationService",
    args: "query, cookieHeader"
  },
  {
    methodName: "listGithubAppInstallations",
    serviceName: "githubAppInstallationService",
    args: "currentUserId, workspaceId"
  },
  {
    methodName: "listGithubRepositories",
    serviceName: "githubSourceReadService",
    args: "currentUserId, workspaceId, query"
  },
  {
    methodName: "getGithubRepository",
    serviceName: "githubSourceReadService",
    args: "currentUserId, workspaceId, repositoryId"
  },
  {
    methodName: "getGithubIssue",
    serviceName: "githubSourceReadService",
    args: "currentUserId, workspaceId, issueId"
  },
  {
    methodName: "listGithubPullRequests",
    serviceName: "githubSourceReadService",
    args: "currentUserId, workspaceId, repositoryId, query"
  },
  {
    methodName: "getGithubPullRequest",
    serviceName: "githubSourceReadService",
    args: "currentUserId, workspaceId, pullRequestId"
  },
  {
    methodName: "listGithubProjectsV2",
    serviceName: "githubProjectV2Service",
    args: "currentUserId, workspaceId, query"
  },
  {
    methodName: "getGithubProjectV2",
    serviceName: "githubProjectV2Service",
    args: "currentUserId, workspaceId, projectV2Id"
  },
  {
    methodName: "listGithubProjectV2Fields",
    serviceName: "githubProjectV2Service",
    args: "currentUserId, workspaceId, projectV2Id"
  },
  {
    methodName: "listGithubProjectV2StatusOptions",
    serviceName: "githubProjectV2Service",
    args: "currentUserId, workspaceId, projectV2Id"
  },
  {
    methodName: "getGithubProjectV2Kanban",
    serviceName: "githubProjectV2Service",
    args: "currentUserId, workspaceId, projectV2Id"
  },
  {
    methodName: "listGithubProjectV2Items",
    serviceName: "githubProjectV2Service",
    args: "currentUserId, workspaceId, projectV2Id"
  },
  {
    methodName: "listGithubPullRequestFiles",
    serviceName: "githubPullRequestRemoteService",
    args: "currentUserId, workspaceId, pullRequestId, query"
  },
  {
    methodName: "getGithubPullRequestConflictStatus",
    serviceName: "githubPullRequestRemoteService",
    args: "currentUserId, workspaceId, pullRequestId"
  },
  {
    methodName: "mergeGithubPullRequest",
    serviceName: "githubPullRequestMergeService",
    args: "currentUserId, workspaceId, pullRequestId, input"
  },
  {
    methodName: "receiveGithubWebhook",
    serviceName: "githubWebhookService",
    args: "input"
  },
  {
    methodName: "startGithubSyncRun",
    serviceName: "githubSyncRunService",
    args: "currentUserId, workspaceId, input, \"manual\", manualIdempotencyKey"
  },
  {
    methodName: "listGithubSyncRuns",
    serviceName: "githubSyncRunService",
    args: "currentUserId, workspaceId, query"
  },
  {
    methodName: "getGithubSyncRun",
    serviceName: "githubSyncRunService",
    args: "currentUserId, workspaceId, syncRunId"
  }
];

for (const { methodName, serviceName, args } of delegatedMethods) {
  const compactArgs = args.replace(/\s+/g, "");

  assert.match(
    compactServiceFile,
    new RegExp(
      `${methodName}\\(.*?returnthis\\.${serviceName}\\.${methodName}\\(${compactArgs}\\);`
    ),
    `${methodName} must delegate to ${serviceName}.`
  );
}

assert.match(
  pullRequestMergeServiceFile,
  /github_updated_at\s*=\s*\$13::timestamptz/,
  "PR merge must refresh github_updated_at so PR lists do not keep stale ordering metadata."
);
assert.match(
  pullRequestMergeServiceFile,
  /\{updated_at\}/,
  "PR merge must refresh raw.updated_at alongside merged_at."
);
