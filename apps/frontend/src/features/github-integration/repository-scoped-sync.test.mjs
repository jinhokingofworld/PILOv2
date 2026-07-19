import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [panel, client, types, sync] = await Promise.all([
  readFile(new URL("./components/github-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("./types/index.ts", import.meta.url), "utf8"),
  readFile(
    new URL("./components/github-connect-sync.tsx", import.meta.url),
    "utf8"
  ),
]);

const snapshotLoader =
  panel.match(
    /async function loadGithubIntegrationSnapshot\([\s\S]*?\n  \}/
  )?.[0] ?? "";
assert.match(
  snapshotLoader,
  /if \(nextRepository\) \{[\s\S]*?listAllGithubProjectsV2\(nextRepository\.id\)/,
  "snapshot loading may fetch ProjectV2s only after a preferred repository resolves in the current page"
);
assert.doesNotMatch(snapshotLoader, /discoverGithubProjectV2/);
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
  /async function handleDiscoverGithubProjectV2[\s\S]{0,1200}const discovery = await[\s\S]{0,600}if \(selectedRepositoryIdRef\.current !== repositoryId\) \{\s*return;[\s\S]{0,400}if \(discovery\.connectionRequired\)/
);
assert.match(
  panel,
  /const requiresSelectedRepository = syncTarget !== "source";[\s\S]{0,300}requiresSelectedRepository && !selectedRepositoryId/
);
assert.match(sync, /option\.value !== "source"/);
assert.match(
  sync,
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
    /async function handleSelectRepository\(repositoryId: string\) \{[\s\S]*?\n  \}\n\n  function clearRepositorySelection/
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
const projectActivationHandler =
  panel.match(
    /async function handleActivateProjectV2\(projectV2Id: string\) \{[\s\S]*?\n  \}\n\n  async function handleStartGithubSyncRun/
  )?.[0] ?? "";
assert.match(
  projectActivationHandler,
  /activateWorkspaceBoardSource\([\s\S]*?repositoryId: selectedRepositoryId[\s\S]*?projectV2Id/,
  "the selected repository and ProjectV2 must become the active Board source"
);
assert.doesNotMatch(projectActivationHandler, /projectIdsByInstallation/);
assert.doesNotMatch(projectActivationHandler, /replaceGithubProjectV2Selections/);

console.log("repository-scoped GitHub feature tests passed");
