import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
}

const [types, client, issueSheet, selector, assigneeStateSource] =
  await Promise.all([
    readFeatureFile("./types/index.ts"),
    readFeatureFile("./api/client.ts"),
    readFeatureFile("./components/board-issue-sheet.tsx"),
    readFeatureFile("./components/board-issue-assignee-selector.tsx"),
    readFeatureFile("./utils/board-assignee-state.ts")
  ]);

const assigneeStateJavaScript = ts.transpileModule(assigneeStateSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const assigneeState = await import(
  `data:text/javascript;base64,${Buffer.from(assigneeStateJavaScript).toString("base64")}`
);

for (const status of ["idle", "loading", "error"]) {
  assert.deepEqual(assigneeState.startAssigneeEditSession(status), {
    error: null,
    status: "idle"
  });
}
assert.deepEqual(assigneeState.startAssigneeEditSession("success"), {
  error: null,
  status: "success"
});

const mergedOptions = assigneeState.filterAssigneeOptions(
  [
    { login: "Alice", avatarUrl: "alice.png" },
    { login: "bob", avatarUrl: null }
  ],
  ["alice", "Carol", "BOB"],
  ""
);
assert.deepEqual(
  mergedOptions.map((option) => option.login),
  ["Alice", "bob", "Carol"]
);
assert.deepEqual(
  assigneeState
    .filterAssigneeOptions(mergedOptions, [], "ALICE")
    .map((option) => option.login),
  ["Alice"]
);

assert.deepEqual(
  assigneeState.toggleAssigneeLogin(["Alice"], "alice", true),
  { limitReached: false, logins: ["Alice"] }
);
assert.deepEqual(
  assigneeState.toggleAssigneeLogin(["Alice"], "Bob", true),
  { limitReached: false, logins: ["Alice", "Bob"] }
);
assert.deepEqual(
  assigneeState.toggleAssigneeLogin(["Alice", "Bob"], "ALICE", false),
  { limitReached: false, logins: ["Bob"] }
);

const nineAssignees = Array.from({ length: 9 }, (_, index) => `user-${index}`);
const tenthAssignee = assigneeState.toggleAssigneeLogin(
  nineAssignees,
  "user-9",
  true
);
assert.equal(tenthAssignee.logins.length, 10);
assert.equal(tenthAssignee.limitReached, false);
assert.deepEqual(
  assigneeState.toggleAssigneeLogin(tenthAssignee.logins, "user-10", true),
  { limitReached: true, logins: tenthAssignee.logins }
);

assert.equal(
  assigneeState.haveSameAssigneeLogins(
    ["Alice", "BOB"],
    ["bob", "alice"]
  ),
  true
);
assert.equal(
  assigneeState.haveSameAssigneeLogins(["Alice"], ["Alice", "Bob"]),
  false
);

assert.match(types, /BoardIssueAssigneeOptionPayload/);
assert.match(types, /assignees\?: string\[\]/);
assert.match(client, /listBoardIssueAssigneeOptions/);
assert.match(client, /assignee-options/);

assert.match(issueSheet, /BoardIssueAssigneeSelector/);
assert.match(issueSheet, /listBoardIssueAssigneeOptions/);
assert.match(issueSheet, /draftAssignees/);
assert.match(issueSheet, /startAssigneeEditSession/);
assert.match(issueSheet, /handleRetryAssigneeOptions/);
assert.match(issueSheet, /onRetry=\{handleRetryAssigneeOptions\}/);
assert.match(
  issueSheet,
  /assigneeOptionsStatus === "success" && assigneesChanged[\s\S]*updateInput\.assignees = draftAssignees/
);
assert.match(
  issueSheet,
  /if \(\s*!isEditing[\s\S]*listBoardIssueAssigneeOptions/
);

assert.match(selector, /export function BoardIssueAssigneeSelector/);
assert.match(selector, /type="checkbox"/);
assert.match(selector, /selectedLogins/);
assert.match(selector, /MAX_BOARD_ISSUE_ASSIGNEES/);
assert.match(selector, /onRetry/);
