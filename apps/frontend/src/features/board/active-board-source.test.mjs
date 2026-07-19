import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const directory = new URL("./", import.meta.url);
const [client, workspaceData, lifecycle, types] = await Promise.all([
  readFile(new URL("api/client.ts", directory), "utf8"),
  readFile(new URL("hooks/use-board-workspace-data.ts", directory), "utf8"),
  readFile(new URL("realtime/board-realtime-lifecycle.ts", directory), "utf8"),
  readFile(new URL("types/index.ts", directory), "utf8")
]);
const boardPanel = await readFile(new URL("components/board-panel.tsx", directory), "utf8");
const githubProject = await readFile(
  new URL("../github-integration/components/github-connect-project.tsx", directory),
  "utf8"
);

assert.match(client, /getActiveBoardSource/);
assert.match(client, /setActiveBoardSource/);
assert.match(workspaceData, /activeSource/);
assert.match(workspaceData, /getActiveBoardSource/);
assert.match(types, /ActiveBoardSourcePayload/);
assert.match(lifecycle, /board:source:join/);
assert.match(lifecycle, /board:source:updated/);
assert.match(lifecycle, /reloadActiveSource/);
assert.doesNotMatch(boardPanel, /readGithubBoardSelection|rememberGithubBoardSelection/);
assert.doesNotMatch(boardPanel, /boardData\.hydrateBoard/);
assert.doesNotMatch(boardPanel, /boardData\.boards\[0\]/);
assert.doesNotMatch(githubProject, /selectedProjectV2Ids|onToggleProjectV2Selection|type="checkbox"/);

console.log("active board source frontend tests passed");
