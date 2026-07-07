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
assert.match(githubTypes, /export type GithubProjectOAuthStatus/);
assert.match(githubTypes, /export type GithubAppInstallation/);
assert.match(githubTypes, /export type GithubAppInstallationDelete/);
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
assert.match(githubApiClient, /getGithubProjectOAuthStatus/);
assert.match(githubApiClient, /startGithubProjectOAuth/);
assert.match(githubApiClient, /disconnectGithubProjectOAuth/);
assert.match(githubApiClient, /\/me\/github\/project-oauth/);
assert.match(githubApiClient, /deleteGithubAppInstallation/);
assert.match(
  githubApiClient,
  /workspaceGithubPath\(workspaceId, `\/installations\/\$\{encodeURIComponent\(installationId\)\}`\)/
);
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
assert.match(githubPanel, /handleStartGithubProjectOAuth/);
assert.match(githubPanel, /handleDisconnectGithubProjectOAuth/);
assert.match(githubPanel, /requiresProjectOAuth/);
assert.match(
  githubPanel,
  /GitHub ProjectV2 OAuth connection is required for personal ProjectV2 sync/
);
assert.match(githubPanel, /handleRequestDeleteGithubAppInstallation/);
assert.match(githubPanel, /handleConfirmDeleteGithubAppInstallation/);
assert.match(githubPanel, /deleteGithubAppInstallation/);
assert.match(githubPanel, /isDeletingInstallation/);
assert.match(githubPanel, /handleStartGithubAppInstallation/);
assert.match(githubPanel, /handleStartGithubSyncRun/);
assert.match(githubPanel, /setSelectedRepositoryId/);
assert.match(githubPanel, /GithubConnectLayout/);
assert.doesNotMatch(githubPanel, /function StatusPill/);
assert.doesNotMatch(githubPanel, /function LoadingRows/);
assert.match(githubConnectLayout, /GithubConnectLayout/);
assert.match(githubConnectLayout, /projectOAuth/);
assert.match(githubConnectLayout, /onRequestDeleteInstallation/);
assert.match(githubConnectLayout, /onCancelDeleteInstallation/);
assert.match(githubConnectLayout, /onConfirmDeleteInstallation/);
assert.doesNotMatch(githubConnectLayout, /GithubConnectSummary/);
assert.doesNotMatch(githubConnectLayout, /summary-strip/);
assert.match(githubConnectLayout, /main-grid/);
assert.match(githubConnectLayout, /PILO GitHub Connect/);
assert.match(githubConnectPrimitives, /GithubConnectPanel/);
assert.match(githubConnectPrimitives, /GithubConnectPill/);
assert.match(githubConnectPrimitives, /GithubConnectEmptyState/);
assert.match(githubConnectSteps, /GithubConnectSteps/);
assert.match(githubConnectSteps, /GitHub ProjectV2 OAuth/);
assert.match(githubConnectSteps, /onStartGithubProjectOAuth/);
assert.match(githubConnectSteps, /onDisconnectGithubProjectOAuth/);
assert.match(githubConnectSteps, /step-card/);
assert.match(githubConnectSteps, /GitHub App 설치/);
assert.match(githubConnectSteps, /GitHub에서 App 설치 해제/);
assert.match(githubConnectSteps, /설치 해제 확인/);
assert.match(githubConnectTables, /GithubConnectSourceTables/);
assert.match(githubConnectTables, /repo-table/);
assert.match(githubConnectTables, /project-table/);
assert.match(githubConnectSidebar, /GithubConnectSidebar/);
assert.match(githubConnectSidebar, /job-list/);
assert.doesNotMatch(githubConnectSidebar, /health-list/);
assert.doesNotMatch(githubConnectSidebar, /HealthRow/);
assert.match(githubConnectFormat, /formatGithubConnectDateTime/);
assert.match(githubConnectFormat, /getGithubConnectSyncStatusLabel/);
assert.doesNotMatch(githubPanel, /window\.confirm/);
assert.doesNotMatch(githubPanel, /pilo_access_token/);
