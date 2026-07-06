import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const githubTypes = await readFile(
  new URL(
    "../../src/features/github-integration/types/index.ts",
    import.meta.url
  ),
  "utf8"
);
const githubApiClient = await readFile(
  new URL(
    "../../src/features/github-integration/api/client.ts",
    import.meta.url
  ),
  "utf8"
);
const githubPanel = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-panel.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectLayout = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-connect-layout.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectPrimitives = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-connect-primitives.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectSummary = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-connect-summary.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectSteps = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-connect-steps.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectTables = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-connect-tables.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectSidebar = await readFile(
  new URL(
    "../../src/features/github-integration/components/github-connect-sidebar.tsx",
    import.meta.url
  ),
  "utf8"
);
const githubConnectFormat = await readFile(
  new URL(
    "../../src/features/github-integration/utils/github-connect-format.ts",
    import.meta.url
  ),
  "utf8"
);

assert.match(githubTypes, /export type GithubOAuthStatus/);
assert.match(githubTypes, /export type GithubAppInstallation/);
assert.match(githubTypes, /export type GithubRepository/);
assert.match(githubTypes, /export type GithubProjectV2/);
assert.match(githubTypes, /export type GithubPullRequest/);
assert.match(githubTypes, /export type GithubSyncRun/);
assert.match(githubTypes, /export type StartGithubSyncRunInput/);
assert.match(githubApiClient, /createGithubIntegrationApiClient/);
assert.match(githubApiClient, /GithubIntegrationApiError/);
assert.match(githubApiClient, /getGithubOAuthStatus/);
assert.match(githubApiClient, /startGithubOAuth/);
assert.match(githubApiClient, /disconnectGithubOAuth/);
assert.match(githubApiClient, /startGithubAppInstallation/);
assert.match(githubApiClient, /listGithubAppInstallations/);
assert.match(githubApiClient, /listGithubRepositories/);
assert.match(githubApiClient, /listGithubProjectsV2/);
assert.match(githubApiClient, /listGithubPullRequests/);
assert.match(githubApiClient, /startGithubSyncRun/);
assert.match(githubApiClient, /listGithubSyncRuns/);
assert.match(githubApiClient, /Authorization/);
assert.match(githubApiClient, /credentials: "include"/);
assert.match(githubApiClient, /success === true/);
assert.doesNotMatch(githubApiClient, /pilo_access_token/);
assert.match(githubPanel, /useAuthSession/);
assert.match(githubPanel, /activeWorkspaceId/);
assert.match(githubPanel, /authSession\?\.accessToken/);
assert.match(githubPanel, /createGithubIntegrationApiClient/);
assert.match(githubPanel, /loadGithubIntegrationSnapshot/);
assert.match(githubPanel, /handleStartGithubOAuth/);
assert.match(githubPanel, /handleDisconnectGithubOAuth/);
assert.match(githubPanel, /handleStartGithubAppInstallation/);
assert.match(githubPanel, /handleStartGithubSyncRun/);
assert.match(githubPanel, /setSelectedRepositoryId/);
assert.match(githubPanel, /GithubConnectLayout/);
assert.doesNotMatch(githubPanel, /function StatusPill/);
assert.doesNotMatch(githubPanel, /function LoadingRows/);
assert.match(githubConnectLayout, /GithubConnectLayout/);
assert.match(githubConnectLayout, /summary-strip/);
assert.match(githubConnectLayout, /main-grid/);
assert.match(githubConnectLayout, /PILO GitHub Connect/);
assert.match(githubConnectPrimitives, /GithubConnectPanel/);
assert.match(githubConnectPrimitives, /GithubConnectPill/);
assert.match(githubConnectPrimitives, /GithubConnectEmptyState/);
assert.match(githubConnectSummary, /GithubConnectSummary/);
assert.match(githubConnectSummary, /js-metric-install/);
assert.match(githubConnectSteps, /GithubConnectSteps/);
assert.match(githubConnectSteps, /step-card/);
assert.match(githubConnectSteps, /GitHub App 설치/);
assert.match(githubConnectTables, /GithubConnectSourceTables/);
assert.match(githubConnectTables, /repo-table/);
assert.match(githubConnectTables, /project-table/);
assert.match(githubConnectSidebar, /GithubConnectSidebar/);
assert.match(githubConnectSidebar, /job-list/);
assert.match(githubConnectSidebar, /health-list/);
assert.match(githubConnectFormat, /formatGithubConnectDateTime/);
assert.match(githubConnectFormat, /getGithubConnectSyncStatusLabel/);
assert.doesNotMatch(githubPanel, /window\.confirm/);
assert.doesNotMatch(githubPanel, /pilo_access_token/);
