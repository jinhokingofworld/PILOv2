import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [panel, client, types, tables, sidebar] = await Promise.all([
  readFile(new URL("./components/github-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("./types/index.ts", import.meta.url), "utf8"),
  readFile(
    new URL("./components/github-connect-tables.tsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./components/github-connect-sidebar.tsx", import.meta.url),
    "utf8"
  ),
]);

assert.match(
  panel,
  /if \(!selectedRepositoryId\) \{[\s\S]{0,160}setPullRequests\(\[\]\)/
);
const snapshotLoader =
  panel.match(
    /async function loadGithubIntegrationSnapshot\([\s\S]*?\n  \}/
  )?.[0] ?? "";
assert.doesNotMatch(
  snapshotLoader,
  /listAllGithubProjectsV2|discoverGithubProjectV2/
);
assert.match(
  panel,
  /listGithubProjectsV2\(workspaceId, \{[\s\S]{0,160}repositoryId/
);
assert.match(
  panel,
  /apiClient\.discoverGithubProjectV2\([\s\S]{0,160}\{\s*repositoryId\s*\}/
);
assert.doesNotMatch(
  panel,
  /searchParams\.get\("github_installation_id"\)[\s\S]{0,400}handleDiscoverGithubProjectV2/
);
assert.match(panel, /repositoryId:\s*selectedRepositoryId/);
assert.match(panel, /selectedRepositoryIdRef\.current = repositoryId/);
assert.match(
  panel,
  /if \(selectedRepositoryIdRef\.current !== repositoryId\) \{[\s\S]{0,80}return;/
);
assert.match(
  panel,
  /async function loadGithubPullRequests[\s\S]{0,1800}catch \(error\) \{\s*if \(selectedRepositoryIdRef\.current !== repositoryId\) \{\s*return;/
);
assert.match(
  panel,
  /async function handleDiscoverGithubProjectV2[\s\S]{0,1200}const discovery = await[\s\S]{0,600}if \(selectedRepositoryIdRef\.current !== repositoryId\) \{\s*return;[\s\S]{0,400}if \(discovery\.connectionRequired\)/
);
assert.match(
  panel,
  /const requiresSelectedRepository = syncTarget !== "source";[\s\S]{0,300}requiresSelectedRepository && !selectedRepositoryId/
);
assert.match(sidebar, /option\.value !== "source"/);
assert.match(
  sidebar,
  /!selectedRepositoryId && syncTarget !== "source"/
);
assert.match(
  client,
  /discoverGithubProjectV2\([\s\S]{0,160}repositoryId: string/
);
assert.match(
  types,
  /ListGithubProjectsV2Query = \{[\s\S]*repositoryId: string;/
);
assert.match(
  types,
  /ReplaceGithubProjectV2SelectionsInput = \{[\s\S]*repositoryId: string;/
);
assert.match(
  types,
  /GithubRepository = \{[\s\S]*installationId: string;/
);
const repositorySelectionHandler =
  panel.match(
    /async function handleSelectRepository\(repositoryId: string\) \{[\s\S]*?\n  \}\n\n  function handleSelectProjectV2/
  )?.[0] ?? "";
assert.match(repositorySelectionHandler, /snapshot\.repositories\.find\(/);
assert.match(
  repositorySelectionHandler,
  /setSelectedInstallationId\(repository\.installationId\)/
);
assert.match(
  repositorySelectionHandler,
  /handleDiscoverGithubProjectV2\(repository\.installationId, repositoryId\)/
);
const projectSelectionSaveHandler =
  panel.match(
    /async function handleSaveProjectV2Selections\(\) \{[\s\S]*?\n  \}\n\n  async function handleStartGithubSyncRun/
  )?.[0] ?? "";
assert.match(
  projectSelectionSaveHandler,
  /snapshot\.repositories\.find\([\s\S]*?candidate\.id === selectedRepositoryId/
);
assert.match(
  projectSelectionSaveHandler,
  /project\.installationId === repository\.installationId/
);
assert.match(
  projectSelectionSaveHandler,
  /installationId: repository\.installationId/
);
assert.doesNotMatch(projectSelectionSaveHandler, /projectIdsByInstallation/);
assert.match(
  tables,
  /저장소를 선택하면 PR 및 ProjectV2 동기화 범위를 관리할 수 있습니다/
);

console.log("repository-scoped GitHub feature tests passed");
