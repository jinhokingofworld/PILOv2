import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [client, panel, types, selection] = await Promise.all([
  readFile(new URL("./api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("./components/github-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./types/index.ts", import.meta.url), "utf8"),
  readFile(new URL("./utils/github-project-selection.ts", import.meta.url), "utf8")
]);
const { resolveGithubActiveBoardSelection } = await import(
  new URL("./utils/github-project-selection.ts", import.meta.url)
);

const repositories = [{ id: "repository-active" }, { id: "repository-explicit" }];
const projects = [
  { id: "project-active", repositoryIds: ["repository-active"] },
  { id: "project-unlinked", repositoryIds: ["repository-explicit"] },
  { id: "project-explicit", repositoryIds: ["repository-explicit"] }
];
const activeBoardSource = {
  repository: { id: "repository-active" },
  project: { id: "project-active" }
};

assert.deepEqual(
  resolveGithubActiveBoardSelection({
    repositories,
    projects,
    activeBoardSource
  }),
  { repositoryId: "repository-active", projectV2Id: "project-active" }
);
assert.deepEqual(
  resolveGithubActiveBoardSelection({
    repositories,
    projects,
    activeBoardSource: null
  }),
  { repositoryId: "", projectV2Id: "" }
);
assert.deepEqual(
  resolveGithubActiveBoardSelection({
    repositories: [{ id: "repository-explicit" }],
    projects,
    activeBoardSource
  }),
  { repositoryId: "", projectV2Id: "" },
  "an active repository outside the current page must stay unselected"
);
assert.deepEqual(
  resolveGithubActiveBoardSelection({
    repositories,
    projects: [{ id: "project-active", repositoryIds: ["repository-explicit"] }],
    activeBoardSource
  }),
  { repositoryId: "repository-active", projectV2Id: "" },
  "an active project not linked to the restored repository must stay unselected"
);
assert.deepEqual(
  resolveGithubActiveBoardSelection({
    repositories,
    projects,
    activeBoardSource,
    preferredRepositoryId: "repository-explicit",
    preferredProjectV2Id: "project-explicit"
  }),
  { repositoryId: "repository-explicit", projectV2Id: "project-explicit" },
  "explicit preferences must win over the active Board source"
);

assert.match(
  types,
  /export type GithubActiveBoardSource = \{[\s\S]*?repository: \{[\s\S]*?id: string;[\s\S]*?project: \{[\s\S]*?id: string;/,
  "GitHub Integration must own the minimal active Board source response type"
);
assert.doesNotMatch(
  client,
  /@\/features\/board/,
  "GitHub Integration must not import Board feature internals"
);
assert.match(
  client,
  /async getWorkspaceActiveBoardSource\([\s\S]*?requestGithubIntegrationData<GithubActiveBoardSource \| null>[\s\S]*?workspaceActiveBoardPath\(workspaceId\)/,
  "the client must read the persisted active Board source"
);

const snapshotLoader =
  panel.match(
    /async function loadGithubIntegrationSnapshot\([\s\S]*?\n  \}/
  )?.[0] ?? "";

assert.match(snapshotLoader, /apiClient\.getWorkspaceActiveBoardSource\(workspaceId\)/);
assert.match(
  snapshotLoader,
  /resolveGithubActiveBoardSelection\(\{[\s\S]*?activeBoardSource,[\s\S]*?preferredRepositoryId,[\s\S]*?preferredProjectV2Id/,
  "snapshot loading must delegate restoration decisions to the tested utility"
);
assert.match(
  snapshotLoader,
  /repositories\.data\.find\([\s\S]*?initialBoardSelection\.repositoryId[\s\S]*?\)[\s\S]*?if \(nextRepository\)[\s\S]*?listAllGithubProjectsV2\(nextRepository\.id\)/,
  "ProjectV2s may load only after the preferred repository resolves in the current result page"
);
const restoredProjectsRequest = snapshotLoader.indexOf(
  "nextProjects = await listAllGithubProjectsV2(nextRepository.id)"
);
const postRestoreGateCheck = snapshotLoader.indexOf(
  "!snapshotRequestGateRef.current.isCurrent(snapshotRequestGeneration)",
  restoredProjectsRequest
);
assert.ok(
  restoredProjectsRequest >= 0 && postRestoreGateCheck > restoredProjectsRequest,
  "a stale snapshot must be rejected after the conditional ProjectV2 request"
);
assert.match(
  selection,
  /if \(!allowFallbackSelection\) \{\s*return "";/,
  "an unavailable persisted ProjectV2 must not select a different project"
);
const pullRequestsLoader =
  panel.match(/async function loadGithubPullRequests\([\s\S]*?\n  \}/)?.[0] ?? "";
assert.match(pullRequestsLoader, /pullRequestsRequestGateRef\.current\.begin\(\)/);
assert.match(
  pullRequestsLoader,
  /selectedRepositoryIdRef\.current === repositoryId[\s\S]*?pullRequestsRequestGateRef\.current\.isCurrent\(requestGeneration\)/
);
assert.equal(
  pullRequestsLoader.match(/if \(!isCurrentRequest\(\)\)/g)?.length,
  3,
  "success, catch, and finally must all reject stale PR requests"
);
assert.match(
  snapshotLoader,
  /selectedRepositoryIdRef\.current = nextRepositoryId;[\s\S]*?if \(nextRepositoryId\)[\s\S]*?loadGithubPullRequests\(nextRepositoryId, false\)/,
  "PR loading must use the restored repository and retain the existing race guard"
);

console.log("active Board selection persistence tests passed");
