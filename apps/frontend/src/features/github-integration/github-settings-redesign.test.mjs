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
assert.equal(
  (
    stepsSource.match(
      /grid-cols-\[26px_minmax\(0,1fr\)_auto_minmax\(0,1fr\)_26px\]/g
    ) ?? []
  ).length,
  3
);
assert.equal(
  (
    stepsSource.match(
      /col-start-3 row-start-1 justify-self-center/g
    ) ?? []
  ).length,
  3,
  "each connection status pill must occupy the centered grid column"
);
assert.equal(
  (
    stepsSource.match(
      /max-\[45rem\]:col-start-2 max-\[45rem\]:row-start-2/g
    ) ?? []
  ).length,
  3,
  "narrow layouts must move each status pill into an explicit follow-up row"
);
assert.equal(
  (stepsSource.match(/max-\[45rem\]:row-start-4/g) ?? []).length,
  3,
  "narrow layouts must move actions below the status and description rows"
);
assert.equal(
  (stepsSource.match(/max-\[45rem\]:row-start-3/g) ?? []).length,
  3,
  "narrow layouts must keep descriptions in their own row"
);
assert.equal(
  (stepsSource.match(/col-start-4 row-span-2 row-start-1 justify-self-end/g) ?? []).length,
  3,
  "desktop actions must occupy the trailing symmetric column"
);
assert.doesNotMatch(stepsSource, /absolute left-1\/2/);
assert.equal(
  (stepsSource.match(/max-\[45rem\]:grid-cols-\[26px_minmax\(0,1fr\)_auto\]/g) ?? [])
    .length,
  3,
  "narrow layouts must drop the symmetric desktop grid before long actions overflow"
);
assert.match(
  stepsSource,
  /const completedDestructiveButtonClassName =\s*"h-10 rounded-\[8px\] border-\[#ffc9c9\] bg-white px-4 text-\[#b42318\] hover:bg-\[#fff1f1\]"/
);
assert.doesNotMatch(
  stepsSource,
  /completedDisconnectButtonClassName/,
  "OAuth disconnect controls must use the same destructive treatment as app uninstall"
);
assert.match(stepsSource, /before:h-\[calc\(100%-16px\)\]/);
assert.doesNotMatch(stepsSource, /@\[48rem\]/);
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
const primitivesSource = await readFile(
  new URL("./components/github-connect-primitives.tsx", import.meta.url),
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

assert.equal(
  (
    layoutSource.match(
      /<GithubConnect(?:Steps|Repositories|Project|Sync)\b/g
    ) ?? []
  ).length,
  4
);
assert.equal(
  (syncSource.match(/<GithubConnectPanel\b/g) ?? []).length,
  1,
  "sync target and recent runs stay in one domain panel"
);
assert.match(
  syncSource,
  /job-list overflow-hidden rounded-\[8px\] border border-\[#e5e9f2\] divide-y divide-\[#e5e9f2\]/
);
assert.match(syncSource, /syncRuns\.map\([\s\S]*?className="p-3"/);
assert.doesNotMatch(
  syncSource,
  /syncRuns\.map\([\s\S]*?rounded-\[8px\] border border-\[#e5e9f2\] bg-\[#fbfcfe\]/
);
assert.match(
  primitivesSource,
  /relative overflow-hidden[^\"]*rounded-\[10px\][^\"]*shadow-\[0_10px_28px_rgba\(15,20,34,0\.08\)\]/
);
assert.match(primitivesSource, /data-github-panel-decoration/);
assert.match(primitivesSource, /aria-hidden/);
assert.match(primitivesSource, /pointer-events-none/);
assert.doesNotMatch(
  stepsSource,
  /divide-y divide-\[#e4e7ec\] rounded-\[8px\] border border-\[#d9dee8\]/
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
assert.match(
  repositorySource,
  /restoredRepository: GithubRepository \| null/,
  "an off-page active repository must be rendered as separate selection context"
);
assert.match(
  repositorySource,
  /restoredRepository \?[\s\S]*?restoredRepository\.fullName/,
  "the repository panel must identify the restored current selection without mixing it into result rows"
);
assert.match(
  repositorySource,
  /repo-row grid grid-cols-\[minmax\(0,1fr\)_auto\][\s\S]*?@\[48rem\]:grid-cols-\[minmax\(180px,1\.7fr\)_90px_90px_108px_86px\]/
);
assert.match(
  repositorySource,
  /col-span-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1[\s\S]*?@\[48rem\]:contents/
);
assert.match(repositorySource, /col-start-2 row-start-1 h-8/);
assert.match(projectSource, /@\/components\/ui\/dialog/);
assert.match(projectSource, /활성 Board 변경/);
assert.match(projectSource, /await onActivateProjectV2\(project\.id\)/);
assert.match(
  projectSource,
  /activeProject\.ownerType === "Organization" \? "Organization" : "Personal"/
);
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
