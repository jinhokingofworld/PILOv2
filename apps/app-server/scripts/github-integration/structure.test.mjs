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
const compactServiceFile = serviceFile.replace(/\s+/g, "");
const entries = await readdir(moduleDirectory, { withFileTypes: true });
const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

const featureServices = [
  {
    fileName: "github-oauth-integration.service.ts",
    className: "GithubOAuthIntegrationService"
  },
  {
    fileName: "github-app-installation.service.ts",
    className: "GithubAppInstallationService"
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
  }
];

for (const { fileName, className } of featureServices) {
  const importPath = `./${fileName.replace(/\.ts$/, "")}`;

  assert.ok(
    fileNames.includes(fileName),
    `${fileName} must exist so #97 service responsibilities stay split by issue area.`
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
    args: "query"
  },
  {
    methodName: "disconnectGithubOAuth",
    serviceName: "githubOAuthIntegrationService",
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
    args: "query"
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
