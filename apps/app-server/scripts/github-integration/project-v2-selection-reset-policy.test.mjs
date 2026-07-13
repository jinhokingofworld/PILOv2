import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const appServerRoot = resolve(import.meta.dirname, "..", "..");
const readSource = (path) => readFile(resolve(appServerRoot, path), "utf8");

const [migration, apiDocument, serviceSource] = await Promise.all([
  readSource("../../db/migrations/034_repository_scope_github_project_v2_selections.sql"),
  readSource("../../docs/api/github-integration-api.md"),
  readSource("src/modules/github-integration/github-project-v2.service.ts")
]);

assert.match(
  migration,
  /DELETE FROM github_project_v2_selections/i,
  "the repository-scoping migration must reset legacy selection rows"
);
assert.match(
  apiDocument,
  /### Legacy ProjectV2 selection reset policy/,
  "the API contract must explicitly document the approved legacy-selection reset policy"
);
assert.match(
  apiDocument,
  /\uC758\uB3C4\uC801\uC73C\uB85C\u0020\uB9AC\uC14B/,
  "legacy selections must be explicitly described as intentionally reset"
);
assert.match(
  apiDocument,
  /\uCD94\uB860\uD558\uAC70\uB098\u0020backfill\(\uBCF5\uAD6C\)\uD558\uC9C0\u0020\uC54A\uB294\uB2E4/,
  "repository links must not be used to infer or backfill legacy selections"
);
assert.match(
  apiDocument,
  /GitHub installation[\s\S]*?repository[\s\S]*?ProjectV2[\s\S]*?\uB2E4\uC2DC\u0020\uC120\uD0DD/,
  "users must reselect ProjectV2 for each required repository after installation sync"
);
assert.match(
  apiDocument,
  /personal ProjectV2[\s\S]*?polling schedule\uB3C4\u0020\uC7AC\uC0DD\uC131/,
  "saving a personal ProjectV2 selection must recreate its polling schedule"
);
assert.match(
  serviceSource,
  /syncSelectionSchedules\(/,
  "selection replacement must retain personal polling schedule synchronization"
);

console.log("project-v2 selection reset policy tests passed");
