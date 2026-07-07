import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [githubTypes, projectV2Service, frontendTypes, apiDoc] =
  await Promise.all([
    readSource("../../src/modules/github-integration/types/index.ts"),
    readSource("../../src/modules/github-integration/github-project-v2.service.ts"),
    readSource(
      "../../../frontend/src/features/github-integration/types/index.ts"
    ),
    readSource("../../../../docs/api/github-integration-api.md")
  ]);

assert.match(
  githubTypes,
  /interface GithubProjectV2ListItemPayload \{[\s\S]*repositoryIds: string\[\];[\s\S]*\}/
);
assert.match(
  frontendTypes,
  /export type GithubProjectV2 = \{[\s\S]*repositoryIds: string\[\];[\s\S]*\}/
);
assert.match(projectV2Service, /repository_ids/);
assert.match(projectV2Service, /github_project_v2_repositories/);
assert.match(projectV2Service, /repositoryIds: this\.toStringArray\(row\.repository_ids\)/);
assert.match(apiDoc, /repositoryIds/);
