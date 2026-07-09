import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(
  new URL(
    "../../src/modules/pr-review/pr-review-conflict-analyzer.ts",
    import.meta.url
  ),
  "utf8"
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
});
const module = { exports: {} };

vm.runInNewContext(transpiled.outputText, {
  exports: module.exports,
  module,
  require
});

const { extractContentConflictHunks } = module.exports;

assert.equal(typeof extractContentConflictHunks, "function");

const hunks = extractContentConflictHunks({
  mergeBaseContent: ["line 1", "const title = 'Meeting';", "line 3"].join("\n"),
  baseContent: ["line 1", "const title = 'Voice meeting';", "line 3"].join("\n"),
  headContent: ["line 1", "const title = 'Meeting room';", "line 3"].join("\n")
});

assert.deepEqual(JSON.parse(JSON.stringify(hunks)), [
  {
    id: "hunk_1",
    header: "@@ -2,1 +2,1 @@",
    baseStartLine: 2,
    baseLineCount: 1,
    currentStartLine: 2,
    currentLineCount: 1,
    incomingStartLine: 2,
    incomingLineCount: 1,
    baseText: "const title = 'Meeting';",
    currentText: "const title = 'Voice meeting';",
    incomingText: "const title = 'Meeting room';"
  }
]);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      extractContentConflictHunks({
        mergeBaseContent: "same",
        baseContent: "same",
        headContent: "same"
      })
    )
  ),
  []
);
