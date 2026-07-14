import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const syncExecutorFile = await readFile(
  new URL(
    "../../src/modules/github-integration/github-sync-executor.service.ts",
    import.meta.url
  ),
  "utf8"
);

assert.match(
  syncExecutorFile,
  /const discovery = await this\.syncGithubProjectV2Discovery\(context\)/
);
assert.match(
  syncExecutorFile,
  /const selectedProjectV2Selections =[\s\S]*await this\.listSelectedGithubProjectV2Selections\(\s*context\.workspaceId,\s*context\.installation\.id,\s*context\.repository\?\.id \?\? null\s*\);[\s\S]*const projectV2Contexts = this\.getGithubProjectV2ContextsForFullSync\(\s*context,\s*discovery\.projectV2s,\s*selectedProjectV2Selections\s*\);/
);
assert.match(
  syncExecutorFile,
  /const uniqueProjectV2s =[\s\S]*new Map\([\s\S]*projectV2\.id[\s\S]*for \(const projectV2 of uniqueProjectV2s\) \{[\s\S]*await this\.syncGithubProjectV2Fields\(projectContext\)[\s\S]*await this\.syncGithubProjectV2Items\(projectContext\)[\s\S]*\}/
);
assert.match(
  syncExecutorFile,
  /for \(const projectV2Context of projectV2Contexts\) \{[\s\S]*await this\.hydrateExistingBoardsForGithubProjectV2\(\s*projectContext,\s*projectV2Context\.repositoryId\s*\);/
);
assert.match(
  syncExecutorFile,
  /interface GithubProjectV2DiscoverySyncResult \{[\s\S]*summary: GithubSyncRunSummary;[\s\S]*projectV2s: GithubProjectV2DiscoveryContext\[\];[\s\S]*\}/
);
assert.match(
  syncExecutorFile,
  /interface GithubProjectV2DiscoveryContext\s+extends GithubSyncProjectV2ContextRow \{[\s\S]*repositoryIds: string\[\];[\s\S]*\}/
);
assert.match(
  syncExecutorFile,
  /\): Promise<GithubProjectV2DiscoverySyncResult> \{/
);
assert.match(
  syncExecutorFile,
  /projectV2s\.push\(\{[\s\S]*id: row\.id,[\s\S]*workspace_id: context\.workspaceId,[\s\S]*installation_id: context\.installation\.id,[\s\S]*github_project_node_id: project\.id,[\s\S]*repositoryIds: \[repository\.id\][\s\S]*\}\)/
);
assert.match(
  syncExecutorFile,
  /private async listSelectedGithubProjectV2Selections\([\s\S]*repositoryId: string \| null[\s\S]*const repositoryFilter = repositoryId[\s\S]*gps\.repository_id = \$3[\s\S]*const values = repositoryId[\s\S]*\[workspaceId, installationId, repositoryId\][\s\S]*:\s*\[workspaceId, installationId\][\s\S]*SELECT[\s\S]*gps\.project_v2_id,[\s\S]*gps\.repository_id[\s\S]*FROM github_project_v2_selections[\s\S]*gp\.workspace_id = \$1[\s\S]*gps\.installation_id = \$2/
);
assert.match(
  syncExecutorFile,
  /private getGithubProjectV2ContextsForFullSync\([\s\S]*selectedProjectV2Selections: GithubProjectV2SelectionRow\[\][\s\S]*selection\.repository_id[\s\S]*candidate\.id === selection\.project_v2_id[\s\S]*candidate\.repositoryIds\.includes\(selection\.repository_id\)/
);
assert.match(
  syncExecutorFile,
  /private async hydrateExistingBoardsForGithubProjectV2\([\s\S]*FROM boards b[\s\S]*SELECT hydrate_pilo_board_from_github\(\$1::uuid, \$2::uuid\)::text AS board_id/
);
assert.match(
  syncExecutorFile,
  /private async hydrateExistingBoardsForGithubProjectV2\([\s\S]*repositoryId = context\.repository\?\.id[\s\S]*const repositoryFilter = repositoryId[\s\S]*AND b\.repository_id = \$\$\{values\.push\(repositoryId\)\}[\s\S]*FROM boards b[\s\S]*\$\{repositoryFilter\}/
);
