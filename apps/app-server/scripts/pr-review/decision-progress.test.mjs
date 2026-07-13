import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const reviewSessionId = "33333333-3333-4333-8333-333333333333";

async function captureProgressUpdate(reviewedCount, totalFileCount) {
  const queries = [];
  const transaction = {
    async queryOne(text, values = []) {
      queries.push({ text, values });
      if (queries.length === 1) {
        return {
          reviewed_count: String(reviewedCount),
          total_file_count: String(totalFileCount)
        };
      }

      return { id: reviewSessionId };
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  await service.syncReviewSessionReviewProgress(transaction, reviewSessionId);

  return queries[1];
}

{
  const update = await captureProgressUpdate(1, 3);

  assert.match(update.text, /reviewed_count = \$2::integer/);
  assert.match(update.text, /total_file_count = \$3::integer/);
  assert.match(update.text, /WHEN \$4::boolean/);
  assert.deepEqual(update.values, [reviewSessionId, 1, 3, false]);
}

{
  const update = await captureProgressUpdate(3, 3);

  assert.deepEqual(update.values, [reviewSessionId, 3, 3, true]);
}

{
  let updateQuery = null;
  const transaction = {
    async queryOne(text, values = []) {
      updateQuery = { text, values };
      return { id: "review-file-id", session_id: reviewSessionId };
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  await service.updateReviewFileDecisionState(transaction, {
    workspaceId: "workspace-id",
    reviewFileId: "review-file-id",
    currentUserId: "user-id",
    status: "approved",
    comment: null
  });

  assert.match(updateQuery.text, /carried_from_decision_id = NULL/);
}
