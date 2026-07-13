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
const tables = await readFile(
  new URL("./components/github-connect-tables.tsx", import.meta.url),
  "utf8"
);
const paginationModule = await import(
  new URL("./utils/github-page-collector.ts", import.meta.url)
);

assert.match(types, /export type GithubProjectV2 = \{[\s\S]*?selected: boolean;/);
assert.match(types, /export type ReplaceGithubProjectV2SelectionsInput = \{[\s\S]*?installationId: string;[\s\S]*?projectV2Ids: string\[\];/);
assert.match(client, /replaceGithubProjectV2Selections\(/);
assert.match(client, /discoverGithubProjectV2/);
assert.match(client, /projects-v2\/discovery/);
assert.match(client, /project-v2-selections/);
assert.match(client, /method: "PUT"/);
assert.match(tables, /type="checkbox"/);
assert.match(tables, /onToggleProjectV2Selection/);
assert.match(tables, /onSaveProjectV2Selections/);
assert.match(panel, /replaceGithubProjectV2Selections/);
assert.match(
  panel,
  /listGithubProjectsV2\(workspaceId, \{[\s\S]{0,160}closed: true,[\s\S]{0,160}limit: 100,/,
  "the complete-list save must include closed ProjectV2s"
);
assert.match(panel, /setSelectedProjectV2Ids/);
assert.match(panel, /async function handleSaveProjectV2Selections/);
const saveSelectionStart = panel.indexOf("async function handleSaveProjectV2Selections");
const nextHandlerStart = panel.indexOf(
  "async function handleStartGithubSyncRun",
  saveSelectionStart
);
assert.ok(saveSelectionStart >= 0 && nextHandlerStart > saveSelectionStart);
assert.match(
  panel.slice(saveSelectionStart, nextHandlerStart),
  /selection\.syncStatus === "queued"/,
  "saving a nonempty selection must begin sync polling"
);
assert.match(panel, /선택된 프로젝트가 없어 보드에 표시할 내용이 없습니다/);
assert.match(
  panel,
  /selection\.syncStatus === "failed"[\s\S]*?선택은 저장됐지만 동기화를 시작하지 못했습니다/,
  "a saved selection with an enqueue failure must show a distinct sync failure message"
);
assert.match(
  panel.slice(saveSelectionStart, nextHandlerStart),
  /selection\.syncStatus === "queued"\)[\s\S]{0,160}setHasRunningSyncRun\(true\)/,
  "a queued selection must start polling"
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
