import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch((error) => {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
}

const [boardDataHook, githubPanel, githubProjectSelection, githubTypes] =
  await Promise.all([
  readFeatureFile("./hooks/use-board-workspace-data.ts"),
  readFile(
    new URL("../github-integration/components/github-panel.tsx", import.meta.url),
    "utf8"
  ),
  readFeatureFile("../github-integration/utils/github-project-selection.ts"),
  readFeatureFile("../github-integration/types/index.ts")
]);

assert.match(
  boardDataHook,
  /const\s+BOARD_ISSUES_PAGE_LIMIT\s*=\s*100;/,
  "Board issue list max page limit should match the Board API max"
);
assert.match(
  boardDataHook,
  /limit:\s*parsedIssueQuery\.limit\s*\?\?\s*BOARD_ISSUES_PAGE_LIMIT/,
  "Board issue list should use the server-supported max page limit by default"
);
assert.doesNotMatch(
  boardDataHook,
  /limit:\s*parsedIssueQuery\.limit\s*\?\?\s*200/,
  "Board issue list should not request more than the Board API max page limit"
);

assert.match(
  githubPanel,
  /if\s*\(\s*\(\s*syncTarget\s*===\s*"full"\s*\|\|\s*projectScopedSyncTargets\.has\(syncTarget\)\s*\)\s*&&\s*selectedProjectV2Id\s*\)\s*\{\s*body\.projectV2Id\s*=\s*selectedProjectV2Id;\s*\}/,
  "Full GitHub sync should include the selected ProjectV2 so fields and items are synced for board hydration"
);
assert.match(
  githubTypes,
  /repositoryIds:\s*string\[\];/,
  "ProjectV2 payload should expose linked repositories so board setup can choose the matching project"
);
assert.match(
  githubProjectSelection,
  /export function selectProjectV2IdForRepository/,
  "GitHub project selection should be a small reusable helper"
);
assert.match(
  githubProjectSelection,
  /project\.repositoryIds\.includes\(repositoryId\)/,
  "GitHub project selection should prefer projects linked to the selected repository"
);
assert.match(
  githubPanel,
  /selectProjectV2IdForRepository\(/,
  "GitHub panel should use repository-aware ProjectV2 selection"
);
assert.match(
  githubPanel,
  /if\s*\(\s*\(\s*syncTarget\s*===\s*"full"\s*\|\|\s*repositoryScopedSyncTargets\.has\(syncTarget\)\s*\)\s*&&\s*selectedRepositoryId\s*\)\s*\{\s*body\.repositoryId\s*=\s*selectedRepositoryId;\s*\}/,
  "Full GitHub sync should include the selected repository so first-sync project hydration can be scoped"
);
