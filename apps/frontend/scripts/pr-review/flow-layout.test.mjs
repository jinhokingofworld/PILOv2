import assert from "node:assert/strict";

import {
  buildPrReviewFileColumnMap,
  buildPrReviewRoleLanes,
  sortPrReviewFlowFiles
} from "../../src/features/pr-review/components/review-canvas/pr-review-flow-layout.ts";

function createFlowFile(reviewFileId, workflowOrder, roleType) {
  return {
    reviewFileId,
    workflowOrder,
    roleType
  };
}

const files = [
  createFlowFile("support-file", 4, "support"),
  createFlowFile("logic-file", 2, "core_logic"),
  createFlowFile("entry-file", 1, "entry"),
  createFlowFile("verification-file", 3, "verification"),
  createFlowFile("second-logic-file", 5, "core_logic")
];

assert.deepEqual(
  sortPrReviewFlowFiles(files).map((file) => file.reviewFileId),
  [
    "entry-file",
    "logic-file",
    "verification-file",
    "support-file",
    "second-logic-file"
  ]
);

const lanes = buildPrReviewRoleLanes(files);
assert.deepEqual(
  lanes.map((lane) => lane.roleType),
  ["entry", "core_logic", "verification", "support"]
);
assert.deepEqual(
  lanes.find((lane) => lane.roleType === "core_logic").files.map(
    (file) => file.reviewFileId
  ),
  ["logic-file", "second-logic-file"]
);
assert.equal(lanes[0].label, "진입점");
assert.equal(lanes[2].label, "검증");

const columnByFileId = buildPrReviewFileColumnMap(files);
assert.equal(columnByFileId.get("entry-file"), 0);
assert.equal(columnByFileId.get("verification-file"), 2);
assert.equal(columnByFileId.get("second-logic-file"), 4);

assert.deepEqual(buildPrReviewRoleLanes([]), []);
