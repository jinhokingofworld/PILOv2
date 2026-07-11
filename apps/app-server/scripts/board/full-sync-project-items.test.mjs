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
  /const selectedProjectV2Ids = await this\.listSelectedGithubProjectV2Ids\(\s*context\.workspaceId,\s*context\.installation\.id\s*\);[\s\S]*const projectV2Contexts = this\.getGithubProjectV2ContextsForFullSync\(\s*context,\s*discovery\.projectV2s,\s*selectedProjectV2Ids\s*\);/
);
assert.match(
  syncExecutorFile,
  /for \(const projectV2 of projectV2Contexts\) \{[\s\S]*const projectContext = this\.withGithubSyncProjectV2\(context, projectV2\);[\s\S]*await this\.syncGithubProjectV2Fields\(projectContext\)[\s\S]*await this\.syncGithubProjectV2Items\(projectContext\)[\s\S]*\}/
);
assert.match(
  syncExecutorFile,
  /await this\.hydrateExistingBoardsForGithubProjectV2\(projectContext\);/
);
assert.match(
  syncExecutorFile,
  /interface GithubProjectV2DiscoverySyncResult \{[\s\S]*summary: GithubSyncRunSummary;[\s\S]*projectV2s: GithubProjectV2DiscoveryContext\[\];[\s\S]*\}/
);
assert.match(
  syncExecutorFile,
  /interface GithubProjectV2DiscoveryContext\s+extends GithubSyncProjectV2ContextRow \{[\s\S]*repositoryNodeIds: string\[\];[\s\S]*\}/
);
assert.match(
  syncExecutorFile,
  /\): Promise<GithubProjectV2DiscoverySyncResult> \{/
);
assert.match(
  syncExecutorFile,
  /projectV2s\.push\(\{[\s\S]*id: row\.id,[\s\S]*workspace_id: context\.workspaceId,[\s\S]*installation_id: context\.installation\.id,[\s\S]*github_project_node_id: project\.id[\s\S]*\}\)/
);
assert.match(
  syncExecutorFile,
  /private async listSelectedGithubProjectV2Ids\([\s\S]*FROM github_project_v2_selections[\s\S]*gp\.workspace_id = \$1[\s\S]*gps\.installation_id = \$2/
);
assert.match(
  syncExecutorFile,
  /private getGithubProjectV2ContextsForFullSync\([\s\S]*selectedProjectV2Ids\.has\(projectV2\.id\)[\s\S]*projectV2\.repositoryNodeIds\.includes\(repositoryNodeId\)/
);
assert.match(
  syncExecutorFile,
  /private async hydrateExistingBoardsForGithubProjectV2\([\s\S]*FROM boards b[\s\S]*SELECT hydrate_pilo_board_from_github\(\$1::uuid, \$2::uuid\)::text AS board_id/
);
