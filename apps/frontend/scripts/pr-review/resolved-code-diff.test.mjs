import assert from "node:assert/strict";

const {
  buildPrReviewContextualDiffRows,
  buildPrReviewResolvedCodeDiff
} = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-resolved-code-diff.ts"
);

{
  const result = buildPrReviewResolvedCodeDiff(
    "const first = 1;\nconst second = 2;\nreturn first + second;\n",
    "const first = 1;\nconst second = 3;\nreturn first + second;\n"
  );

  assert.deepEqual(result.changedLineNumbers, [2]);
  assert.deepEqual(result.changeBlocks, [{ startLine: 2, endLine: 2 }]);
  assert.deepEqual(
    result.rows.filter((row) => row.type !== "unchanged"),
    [
      {
        oldLineNumber: 2,
        newLineNumber: null,
        text: "const second = 2;",
        type: "deleted"
      },
      {
        oldLineNumber: null,
        newLineNumber: 2,
        text: "const second = 3;",
        type: "added"
      }
    ]
  );
}

{
  const result = buildPrReviewResolvedCodeDiff(
    "alpha\nomega\n",
    "alpha\nbeta\ngamma\nomega\n"
  );

  assert.deepEqual(result.changedLineNumbers, [2, 3]);
  assert.deepEqual(result.changeBlocks, [{ startLine: 2, endLine: 3 }]);
}

{
  const result = buildPrReviewResolvedCodeDiff(
    "alpha\nbeta\nomega\n",
    "alpha\nomega\n"
  );

  assert.deepEqual(result.changedLineNumbers, [2]);
  assert.deepEqual(result.changeBlocks, [{ startLine: 2, endLine: 2 }]);
}

{
  const result = buildPrReviewResolvedCodeDiff("same\n", "same\n");

  assert.deepEqual(result.changedLineNumbers, []);
  assert.deepEqual(result.changeBlocks, []);
  assert.deepEqual(buildPrReviewContextualDiffRows(result.rows), []);
}

{
  const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
  const resolved = [...original];
  resolved[1] = "line two changed";
  resolved[17] = "line eighteen changed";
  const result = buildPrReviewResolvedCodeDiff(
    `${original.join("\n")}\n`,
    `${resolved.join("\n")}\n`
  );
  const contextualRows = buildPrReviewContextualDiffRows(result.rows, 1);

  assert.equal(
    contextualRows.some((row) => row.type === "separator"),
    true
  );
}

console.log("PR Review resolved code diff tests passed");
