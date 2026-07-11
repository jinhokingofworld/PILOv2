import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

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
const paginationSource = await readFile(
  new URL("./utils/github-project-v2-pagination.ts", import.meta.url),
  "utf8"
);
const paginationModule = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(paginationSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText
  ).toString("base64")}`
);

assert.match(types, /export type GithubProjectV2 = \{[\s\S]*?selected: boolean;/);
assert.match(types, /export type ReplaceGithubProjectV2SelectionsInput = \{[\s\S]*?installationId: string;[\s\S]*?projectV2Ids: string\[\];/);
assert.match(client, /replaceGithubProjectV2Selections\(/);
assert.match(client, /project-v2-selections/);
assert.match(client, /method: "PUT"/);
assert.match(tables, /type="checkbox"/);
assert.match(tables, /onToggleProjectV2Selection/);
assert.match(tables, /onSaveProjectV2Selections/);
assert.match(panel, /replaceGithubProjectV2Selections/);
assert.match(
  panel,
  /listGithubProjectsV2\(workspaceId, \{\s*closed: true,\s*limit: 100,/,
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
assert.doesNotMatch(
  panel.slice(saveSelectionStart, nextHandlerStart),
  /startGithubSyncRun/,
  "saving a selection must not start a sync"
);
assert.match(
  panel,
  /projectScopedSyncTargets\.has\(syncTarget\)\s*&&\s*selectedProjectV2Id[\s\S]*?body\.projectV2Id/,
  "only an explicit ProjectV2 sync may use the Board navigation selection"
);

{
  const requestedPages = [];
  const allProjects = await paginationModule.collectGithubProjectV2Pages(
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
