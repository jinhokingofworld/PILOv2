import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [boardDataHook, boardPanel] = await Promise.all([
  readFile(
    new URL("./hooks/use-board-workspace-data.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("./components/board-panel.tsx", import.meta.url), "utf8"),
]);

const backgroundRefresh = boardDataHook.match(
  /const refreshBoard = useCallback\([\s\S]*?\n  const hydrateBoard/,
)?.[0];
const workspaceBackgroundRefresh = boardDataHook.match(
  /const refreshWorkspace = useCallback\([\s\S]*?\n  const refreshBoard/,
)?.[0];

assert.ok(
  backgroundRefresh,
  "Board data hook should expose a dedicated background refresh path",
);
assert.doesNotMatch(
  backgroundRefresh,
  /setBoardStatus\("loading"\)/,
  "Background refresh should not switch the Board to its full-loading state",
);
assert.doesNotMatch(
  backgroundRefresh,
  /setBoardState\(emptyBoardState\)/,
  "Background refresh failure should preserve the current Board snapshot",
);
assert.match(
  backgroundRefresh,
  /setBoardState\(\(current\) => resolveBackgroundSnapshot\(current, outcome\)\)/,
  "A successful background refresh should replace the current Board snapshot",
);
assert.match(
  boardDataHook,
  /async function loadSelectedBoard\(\)[\s\S]*?setBoardStatus\("loading"\)/,
  "The initial Board load should keep using the full-loading state",
);
assert.ok(
  workspaceBackgroundRefresh,
  "Board data hook should expose a dedicated catalog background refresh path",
);
assert.doesNotMatch(
  workspaceBackgroundRefresh,
  /setCatalog\(emptyCatalog\)|setCatalogStatus\("loading"\)/,
  "Catalog background failure should preserve the current catalog and selection",
);

assert.match(
  boardPanel,
  /reloadBoard:\s*boardData\.refreshBoard/,
  "Realtime invalidations should refresh the Board in the background",
);
assert.match(
  boardPanel,
  /reloadActiveSource:\s*boardData\.refreshWorkspace/,
  "Realtime source invalidations should preserve the current catalog while refreshing",
);
assert.match(
  boardPanel,
  /void boardData\.refreshWorkspace\(\);\s*void boardData\.refreshBoard\(\);/,
  "Manual refresh should refresh an existing Board snapshot in the background",
);
assert.match(
  boardDataHook,
  /const boardRequestCoordinator = useMemo\([\s\S]*?createBoardRequestCoordinator/,
  "Initial and background Board loads should share a request-generation coordinator",
);
assert.match(
  boardDataHook,
  /const moveIssueStatus = useCallback[\s\S]*?boardRequestCoordinator\.beginMutation\(\)/,
  "Moving an issue should invalidate older Board snapshots",
);
assert.match(
  boardDataHook,
  /const createBoardIssue = useCallback[\s\S]*?boardRequestCoordinator\.beginMutation\(\)/,
  "Creating an issue should invalidate older Board snapshots",
);
assert.match(
  boardPanel,
  /function handleIssueUpdated\(\) \{\s*void boardData\.refreshBoard\(\);/,
  "Issue detail updates should preserve the Board while refreshing its snapshot",
);
assert.match(
  boardPanel,
  /const isBoardLoading = boardData\.boardStatus === "loading"/,
  "Board interactions should only be gated by the initial full-loading state",
);

console.log("board background refresh regression tests passed");
