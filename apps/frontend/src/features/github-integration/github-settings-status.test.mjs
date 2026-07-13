import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const statusComponent = await readFile(
  new URL("./components/github-settings-status.tsx", import.meta.url),
  "utf8"
);
const settingsDialog = await readFile(
  new URL("../../components/app-settings-dialog.tsx", import.meta.url),
  "utf8"
);
const appSidebar = await readFile(
  new URL("../../components/app-sidebar.tsx", import.meta.url),
  "utf8"
);

assert.match(statusComponent, /useAuthSession/);
assert.match(statusComponent, /createGithubIntegrationApiClient/);
assert.match(statusComponent, /getGithubOAuthStatus/);
assert.match(statusComponent, /getGithubProjectOAuthStatus/);
assert.match(statusComponent, /listGithubAppInstallations/);
assert.match(statusComponent, /Promise\.all/);
assert.match(statusComponent, /불러오는 중/);
assert.match(statusComponent, /불러오지 못했습니다/);
assert.match(statusComponent, /설치된 GitHub App이 없습니다/);
assert.match(statusComponent, /onManage/);
assert.match(statusComponent, /function GithubManagementAction/);
assert.match(statusComponent, /disabled=\{!canManageWorkspace\}/);
assert.match(statusComponent, /errorMessage \?[\s\S]*GithubManagementAction/);
assert.match(statusComponent, /!snapshot \?[\s\S]*GithubManagementAction/);

assert.match(settingsDialog, /githubContent: ReactNode/);
assert.doesNotMatch(settingsDialog, /MOCK_GITHUB_CONNECTIONS/);
assert.match(appSidebar, /GithubSettingsStatus/);
assert.match(appSidebar, /handleManageGithub/);
assert.match(appSidebar, /router\.push\("\/github"\)/);
assert.match(appSidebar, /onManage=\{handleManageGithub\}/);
