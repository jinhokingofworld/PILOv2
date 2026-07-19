import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getGithubSettingsAccessState } from "./utils/github-settings-access.ts";

const stepsSource = await readFile(
  new URL("./components/github-connect-steps.tsx", import.meta.url),
  "utf8"
);

assert.match(stepsSource, /1\. GitHub 계정 연결/);
assert.match(stepsSource, /2\. GitHub App 설치/);
assert.match(stepsSource, /3\. Project 작업 권한/);
assert.match(stepsSource, /보드 편집 권한 필요/);
assert.match(stepsSource, /getGithubSettingsAccessState/);
assert.match(
  stepsSource,
  /flex flex-col flex-wrap gap-4 p-4 @\[48rem\]:flex-row/
);
assert.equal(
  (
    stepsSource.match(
      /flex flex-col flex-wrap gap-4 p-4 @\[48rem\]:flex-row/g
    ) ?? []
  ).length,
  2
);
assert.doesNotMatch(stepsSource, /grid-cols-3/);
assert.doesNotMatch(stepsSource, /title="현재 작업"/);
assert.doesNotMatch(stepsSource, /onStartSync/);
assert.doesNotMatch(stepsSource, /isSyncing/);
assert.doesNotMatch(stepsSource, /동기화 시작/);

assert.deepEqual(
  getGithubSettingsAccessState({
    connected: false,
    hasInstallation: false,
    projectOAuthConnected: false
  }),
  {
    canInstallGithubApp: false,
    canConnectProjectOAuth: false,
    canChooseRepository: false,
    githubStepStatus: "required",
    installationStepStatus: "blocked",
    projectStepStatus: "blocked"
  }
);

const repositorySource = await readFile(
  new URL("./components/github-connect-repositories.tsx", import.meta.url),
  "utf8"
);
const projectSource = await readFile(
  new URL("./components/github-connect-project.tsx", import.meta.url),
  "utf8"
);
const panelSource = await readFile(
  new URL("./components/github-panel.tsx", import.meta.url),
  "utf8"
);
const layoutSource = await readFile(
  new URL("./components/github-connect-layout.tsx", import.meta.url),
  "utf8"
);
const syncSource = await readFile(
  new URL("./components/github-connect-sync.tsx", import.meta.url),
  "utf8"
);

assert.match(layoutSource, /GithubConnectRepositories/);
assert.match(layoutSource, /GithubConnectProject/);
assert.match(layoutSource, /GithubConnectSync/);
assert.doesNotMatch(layoutSource, /main-grid/);
assert.match(syncSource, /동기화 대상/);
assert.match(syncSource, /동기화 시작/);
assert.match(syncSource, /최근 수동 실행/);
assert.match(syncSource, /아직 수동 동기화 기록이 없습니다/);
assert.match(syncSource, /selectedProjectV2Id/);
assert.match(
  syncSource,
  /new Set<GithubSyncTarget>\(\[\s*"project_v2",\s*"project_v2_fields",\s*"project_v2_items"\s*\]\)/
);
assert.match(
  syncSource,
  /projectScopedSyncTargets\.has\(option\.value\) && !selectedProjectV2Id/
);
assert.match(
  syncSource,
  /projectScopedSyncTargets\.has\(syncTarget\) && !selectedProjectV2Id/
);
assert.match(syncSource, /Project v2를 먼저 선택해 주세요/);
assert.doesNotMatch(
  syncSource,
  /projectScopedSyncTargets[^;]*"full"/
);
assert.doesNotMatch(panelSource, /loadGithubPullRequests/);
assert.doesNotMatch(panelSource, /pullRequestsRequestGateRef/);
assert.doesNotMatch(panelSource, /setPullRequests/);

assert.match(repositorySource, /Project를 조회하고 동기화할 repository/);
assert.doesNotMatch(repositorySource, /Pull Request 조회 기준/);
assert.match(projectSource, /@\/components\/ui\/dialog/);
assert.match(projectSource, /활성 Board 변경/);
assert.match(projectSource, /await onActivateProjectV2\(project\.id\)/);
assert.match(
  panelSource,
  /async function handleActivateProjectV2\(projectV2Id: string\)/
);
assert.match(panelSource, /await apiClient\.activateWorkspaceBoardSource/);
assert.doesNotMatch(panelSource, /handleSaveProjectV2Selections/);

assert.deepEqual(
  getGithubSettingsAccessState({
    connected: true,
    hasInstallation: true,
    projectOAuthConnected: true
  }),
  {
    canInstallGithubApp: true,
    canConnectProjectOAuth: true,
    canChooseRepository: true,
    githubStepStatus: "complete",
    installationStepStatus: "complete",
    projectStepStatus: "complete"
  }
);

assert.equal(
  getGithubSettingsAccessState({
    connected: true,
    hasInstallation: false,
    projectOAuthConnected: false
  }).canInstallGithubApp,
  true
);

assert.deepEqual(
  getGithubSettingsAccessState({
    connected: true,
    hasInstallation: true,
    projectOAuthConnected: false
  }),
  {
    canInstallGithubApp: true,
    canConnectProjectOAuth: true,
    canChooseRepository: true,
    githubStepStatus: "complete",
    installationStepStatus: "complete",
    projectStepStatus: "optional"
  }
);
