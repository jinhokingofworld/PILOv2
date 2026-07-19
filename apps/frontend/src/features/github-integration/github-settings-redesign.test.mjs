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
  /disabled=\{!access\.canChooseRepository \|\| isSyncing \|\| isLoading\}/
);
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
assert.match(
  panelSource,
  /void handleActivateProjectV2\(selectedProjectV2Id\)\.catch\(\(\) => undefined\);/
);

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
