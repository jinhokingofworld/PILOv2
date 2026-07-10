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
assert.match(githubPanel, /useSearchParams/);
assert.match(githubPanel, /activeWorkspaceId/);
assert.match(githubPanel, /authSession\?\.accessToken/);
assert.match(githubPanel, /createGithubIntegrationApiClient/);
assert.match(githubPanel, /loadGithubIntegrationSnapshot/);
assert.match(githubPanel, /github_callback_error/);
assert.match(githubPanel, /github_oauth_error/);
assert.match(githubPanel, /account_already_connected/);
assert.match(githubPanel, /authorization_cancelled/);
assert.match(githubPanel, /invalid_state/);
assert.match(githubPanel, /project_oauth_scope_missing/);
assert.match(githubPanel, /installation_not_accessible/);
assert.match(
  githubPanel,
  /이미 다른 PILO 계정에 연결된 GitHub 계정입니다/
);
assert.match(githubPanel, /GitHub 승인이 취소되었습니다/);
assert.match(githubPanel, /GitHub 연동 요청이 만료되었거나 이미 사용되었습니다/);
assert.match(githubPanel, /GitHub ProjectV2 권한이 부족합니다/);
assert.match(githubPanel, /현재 연결된 GitHub 계정에서 접근할 수 없는 GitHub App 설치입니다/);
assert.match(githubPanel, /window\.history\.replaceState/);
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
assert.match(
  githubPanel,
  /\(syncTarget === "full" \|\| repositoryScopedSyncTargets\.has\(syncTarget\)\)/
);
assert.match(
  githubPanel,
  /\(syncTarget === "full" \|\| projectScopedSyncTargets\.has\(syncTarget\)\)/
);
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
assert.match(githubConnectLayout, /main-grid grid items-start/);
assert.doesNotMatch(githubConnectLayout, /PILO GitHub Connect/);
assert.match(githubConnectPrimitives, /GithubConnectPanel/);
assert.match(githubConnectPrimitives, /GithubConnectPill/);
assert.match(githubConnectPrimitives, /GithubConnectEmptyState/);
assert.match(githubConnectPrimitives, /@\/components\/ui\/collapsible/);
assert.match(githubConnectPrimitives, /CollapsibleContent/);
assert.match(githubConnectPrimitives, /CollapsibleTrigger/);
assert.match(githubConnectPrimitives, /collapsible\?: boolean/);
assert.match(githubConnectSteps, /GithubConnectSteps/);
assert.match(githubConnectSteps, /현재 작업/);
assert.match(githubConnectSteps, /1\. GitHub 계정 연결/);
assert.match(githubConnectSteps, /2\. 설치와 데이터 확인/);
assert.match(githubConnectSteps, /3\. Personal Project access/);
assert.match(githubConnectSteps, /동기화 시작/);
assert.match(githubConnectSteps, /새로고침/);
assert.match(githubConnectSteps, /ProjectV2 OAuth/);
assert.match(githubConnectSteps, /onStartGithubProjectOAuth/);
assert.match(githubConnectSteps, /onDisconnectGithubProjectOAuth/);
assert.match(githubConnectSteps, /onStartSync/);
assert.match(githubConnectSteps, /completedTaskCardClassName/);
assert.match(githubConnectSteps, /pendingTaskCardClassName/);
assert.match(
  githubConnectSteps,
  /connected \? completedTaskCardClassName : pendingTaskCardClassName/
);
assert.match(
  githubConnectSteps,
  /hasInstallation[\s\S]*\? completedTaskCardClassName[\s\S]*: pendingTaskCardClassName/
);
assert.match(
  githubConnectSteps,
  /projectOAuthConnected[\s\S]*\? completedTaskCardClassName[\s\S]*: pendingTaskCardClassName/
);
assert.doesNotMatch(githubConnectSteps, /disabled=\{connected \|\|/);
assert.doesNotMatch(
  githubConnectSteps,
  /!connected \|\|[\s\S]*hasInstallation \|\|[\s\S]*redirectAction === "installation"/
);
assert.doesNotMatch(
  githubConnectSteps,
  /projectOAuthConnected \|\|[\s\S]*redirectAction === "project_oauth"/
);
assert.doesNotMatch(githubConnectSteps, /step-card/);
assert.match(githubConnectSteps, /GitHub에서 App 설치 해제/);
assert.match(githubConnectSteps, /설치 해제 확인/);
assert.match(githubConnectTables, /GithubConnectSourceTables/);
assert.match(githubConnectTables, /repo-table/);
assert.match(githubConnectTables, /project-table/);
assert.match(githubConnectTables, /title="Pull Requests"/);
assert.match(githubConnectTables, /pullRequestsTotal/);
assert.equal((githubConnectTables.match(/collapsible/g) ?? []).length, 3);
assert.match(githubConnectSidebar, /GithubConnectSidebar/);
assert.match(githubConnectSidebar, /job-list/);
assert.equal((githubConnectSidebar.match(/collapsible/g) ?? []).length, 1);
assert.doesNotMatch(githubConnectSidebar, /title="Pull Requests"/);
assert.doesNotMatch(githubConnectSidebar, /health-list/);
assert.doesNotMatch(githubConnectSidebar, /HealthRow/);
assert.match(githubConnectFormat, /formatGithubConnectDateTime/);
assert.match(githubConnectFormat, /getGithubConnectSyncStatusLabel/);
assert.doesNotMatch(githubPanel, /window\.confirm/);
assert.doesNotMatch(githubPanel, /pilo_access_token/);

await import("../../src/features/github-integration/github-sync-progress.test.mjs");
await import("../../src/features/github-integration/github-sync-polling.test.mjs");
