import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../../src/modules/pr-review/pr-review-diff-parser.ts", import.meta.url),
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
  module
});

const { parseUnifiedDiffPatch } = module.exports;

assert.equal(typeof parseUnifiedDiffPatch, "function");

const rows = parseUnifiedDiffPatch(`@@ -10,3 +10,4 @@
 unchanged
-old value
+new value
+another value
\\ No newline at end of file`);

assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
  {
    type: "unchanged",
    oldLineNumber: 10,
    newLineNumber: 10,
    oldText: "unchanged",
    newText: "unchanged"
  },
  {
    type: "deleted",
    oldLineNumber: 11,
    newLineNumber: null,
    oldText: "old value",
    newText: null
  },
  {
    type: "added",
    oldLineNumber: null,
    newLineNumber: 11,
    oldText: null,
    newText: "new value"
  },
  {
    type: "added",
    oldLineNumber: null,
    newLineNumber: 12,
    oldText: null,
    newText: "another value"
  }
]);

assert.deepEqual(
  JSON.parse(JSON.stringify(parseUnifiedDiffPatch("diff --git a/file b/file"))),
  []
);
