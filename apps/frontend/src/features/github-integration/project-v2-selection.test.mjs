import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const types = await readFile(
  new URL("./types/index.ts", import.meta.url),
  "utf8"
);
const client = await readFile(
  new URL("./api/client.ts", import.meta.url),
  "utf8"
);
const panel = await readFile(
  new URL("./components/github-panel.tsx", import.meta.url),
  "utf8"
);
const project = await readFile(
  new URL("./components/github-connect-project.tsx", import.meta.url),
  "utf8"
);
const paginationModule = await import(
  new URL("./utils/github-page-collector.ts", import.meta.url)
);

assert.match(types, /export type GithubProjectV2 = \{[\s\S]*?selected: boolean;/);
assert.match(types, /export type ReplaceGithubProjectV2SelectionsInput = \{[\s\S]*?installationId: string;[\s\S]*?projectV2Ids: string\[\];/);
assert.match(client, /activateWorkspaceBoardSource/);
assert.match(client, /discoverGithubProjectV2/);
assert.match(client, /projects-v2\/discovery/);
assert.match(client, /method: "PUT"/);
assert.doesNotMatch(project, /type="checkbox"|onToggleProjectV2Selection|selectedProjectV2Ids/);
assert.match(project, /onActivateProjectV2/);
assert.match(panel, /activateWorkspaceBoardSource/);
assert.match(
  panel,
  /listGithubProjectsV2\(workspaceId, \{[\s\S]{0,160}closed: true,[\s\S]{0,160}limit: 100,/,
  "the complete-list save must include closed ProjectV2s"
);
assert.doesNotMatch(panel, /setSelectedProjectV2Ids|replaceGithubProjectV2Selections|rememberGithubBoardSelection/);
assert.match(panel, /async function handleActivateProjectV2/);
const saveSelectionStart = panel.indexOf("async function handleActivateProjectV2");
const nextHandlerStart = panel.indexOf(
  "async function handleStartGithubSyncRun",
  saveSelectionStart
);
assert.ok(saveSelectionStart >= 0 && nextHandlerStart > saveSelectionStart);
assert.match(
  panel.slice(saveSelectionStart, nextHandlerStart),
  /activateWorkspaceBoardSource/,
  "saving a selected ProjectV2 must activate the shared Board"
);
assert.match(
  panel,
  /Workspace Owner만 활성 Board를 변경할 수 있습니다/,
  "only the workspace owner may switch the shared Board source"
);
assert.match(
  panel.slice(saveSelectionStart, nextHandlerStart),
  /activateWorkspaceBoardSource\([\s\S]{0,240}projectV2Id/,
  "the selected ProjectV2 must be the only active Board source input"
);
assert.match(panel, /handleDiscoverGithubProjectV2/);
assert.match(panel, /discovery\.connectionRequired/);
assert.match(panel, /handleStartGithubProjectOAuth/);
assert.match(
  panel,
  /projectScopedSyncTargets\.has\(syncTarget\)\s*&&\s*selectedProjectV2Id[\s\S]*?body\.projectV2Id/,
  "only an explicit ProjectV2 sync may use the Board navigation selection"
);

{
  const requestedPages = [];
  const allProjects = await paginationModule.collectGithubPages(
    async (page) => {
      requestedPages.push(page);
      return page === 1
        ? {
            data: Array.from({ length: 100 }, (_, index) => ({
              id: `project-${index}`,
              selected: index === 99,
              closed: false
            })),
            meta: { page, limit: 100, total: 102 }
          }
        : {
            data: [
              { id: "project-100", selected: true, closed: true },
              { id: "project-101", selected: false, closed: false }
            ],
            meta: { page, limit: 100, total: 102 }
          };
    }
  );

  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(allProjects.length, 102);
  assert.equal(
    allProjects.filter((project) => project.selected).length,
    2,
    "selected projects on later pages must be retained before a complete-list save"
  );
  assert.equal(
    allProjects.find((project) => project.id === "project-100")?.selected,
    true,
    "a selected closed ProjectV2 must be retained before a complete-list save"
  );
}
