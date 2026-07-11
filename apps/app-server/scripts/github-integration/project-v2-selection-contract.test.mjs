import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repositoryRoot = new URL("../../../../", import.meta.url);
const readRepositoryFile = (path) => readFile(new URL(path, repositoryRoot), "utf8");

const [migration, dto, types, apiDocument] = await Promise.all([
  readRepositoryFile("db/migrations/025_create_github_project_v2_selections.sql"),
  readRepositoryFile(
    "apps/app-server/src/modules/github-integration/dto/index.ts"
  ),
  readRepositoryFile("apps/app-server/src/modules/github-integration/types/index.ts"),
  readRepositoryFile("docs/api/github-integration-api.md")
]);

assert.match(
  migration,
  /CREATE TABLE github_project_v2_selections/i,
  "The selection relation must be created."
);
assert.match(
  migration,
  /installation_id UUID NOT NULL\s+REFERENCES github_installations\(id\) ON DELETE CASCADE/i,
  "Selections must be removed with their installation."
);
assert.match(
  migration,
  /project_v2_id UUID NOT NULL\s+REFERENCES github_projects_v2\(id\) ON DELETE CASCADE/i,
  "Selections must be removed with their ProjectV2."
);
assert.match(
  migration,
  /PRIMARY KEY \(installation_id, project_v2_id\)/i,
  "Each installation may select a ProjectV2 at most once."
);
assert.match(
  migration,
  /CREATE INDEX idx_github_project_v2_selections_project_v2_id\s+ON github_project_v2_selections\(project_v2_id\)/i,
  "ProjectV2 selection lookups need an index."
);

assert.match(dto, /interface ReplaceGithubProjectV2SelectionsRequest[\s\S]*installationId\?: unknown[\s\S]*projectV2Ids\?: unknown/, "The selection replacement request must accept installationId and projectV2Ids.");
assert.match(types, /interface GithubProjectV2SelectionPayload[\s\S]*installationId: string;[\s\S]*projectV2Ids: string\[\];/, "The selection replacement payload must return the installation and selected ProjectV2 IDs.");
assert.match(types, /interface GithubProjectV2ListItemPayload[\s\S]*selected: boolean;/, "ProjectV2 list items must expose selected state.");

assert.match(
  apiDocument,
  /\| `PUT` \| `\/workspaces\/\{workspaceId\}\/github\/project-v2-selections` \|/,
  "The API document must describe the selection replacement endpoint."
);
assert.match(
  apiDocument,
  /`selected`\s*:\s*boolean/i,
  "ProjectV2 list payloads must document the selected field."
);
assert.match(
  apiDocument,
  /`full` sync[\s\S]{0,220}선택된 ProjectV2/,
  "The API document must state that full sync details only selected ProjectV2s."
);

assert.match(
  apiDocument,
  /Full sync discovers every ProjectV2 metadata record and repository link; only\s+stored selections receive fields, items, and Board hydration\./,
  "The API document must distinguish full discovery from selected-only detail sync."
);
assert.match(
  apiDocument,
  /`full` target rejects\s+`projectV2Id`; `project_v2`, `project_v2_fields`, and `project_v2_items` require it\./,
  "The API document must distinguish full and explicit ProjectV2 target validation."
);

console.log("project-v2 selection contract tests passed");
