import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildResolvedFileContent } = require(
  "../../dist/modules/pr-review/pr-review-conflict-resolution.js"
);

const hunks = [
  {
    id: "hunk_1",
    incomingStartLine: 2,
    incomingLineCount: 1,
    incomingText: "pr-one"
  },
  {
    id: "hunk_2",
    incomingStartLine: 4,
    incomingLineCount: 2,
    incomingText: "pr-two-a\npr-two-b"
  }
];

assert.equal(
  buildResolvedFileContent({
    headContent: "intro\npr-one\nmiddle\npr-two-a\npr-two-b\nend",
    hunks,
    resolvedHunks: [
      { hunkId: "hunk_1", resolvedText: "target-one" },
      { hunkId: "hunk_2", resolvedText: "pr-two-a\ntarget-two" }
    ]
  }),
  "intro\ntarget-one\nmiddle\npr-two-a\ntarget-two\nend"
);

assert.equal(
  buildResolvedFileContent({
    headContent: "before\nremove-me\nafter",
    hunks: [
      {
        id: "delete_hunk",
        incomingStartLine: 2,
        incomingLineCount: 1,
        incomingText: "remove-me"
      }
    ],
    resolvedHunks: [{ hunkId: "delete_hunk", resolvedText: "" }]
  }),
  "before\nafter"
);

console.log("PR Review conflict resolution tests passed");
