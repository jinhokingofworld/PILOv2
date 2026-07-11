import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PROCESSING_STALE_TIMEOUT_SECONDS,
  QUEUED_STALE_TIMEOUT_SECONDS,
  PrReviewAnalysisJobRecoveryService
} = require(
  "../../dist/modules/pr-review/pr-review-analysis-job-recovery.service.js"
);

class FakeDatabase {
  constructor(rows = []) {
    this.rows = rows;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    return this.rows;
  }
}

{
  const database = new FakeDatabase([
    {
      job_id: "11111111-1111-1111-1111-111111111111",
      review_session_id: "22222222-2222-2222-2222-222222222222"
    }
  ]);
  const recovery = new PrReviewAnalysisJobRecoveryService(database);

  assert.equal(await recovery.recoverStaleJobs(), 1);
  assert.equal(PROCESSING_STALE_TIMEOUT_SECONDS, 20 * 60);
  assert.equal(QUEUED_STALE_TIMEOUT_SECONDS, 60 * 60);
  assert.deepEqual(database.calls[0].values.slice(0, 2), [20 * 60, 60 * 60]);
  assert.equal(database.calls[0].values[3], "ANALYSIS_PROVIDER_FAILED");
  assert.match(database.calls[0].text, /job\.status = 'processing'/);
  assert.match(database.calls[0].text, /job\.status = 'queued'/);
  assert.match(database.calls[0].text, /FOR UPDATE OF job, review_session SKIP LOCKED/);
  assert.match(database.calls[0].text, /UPDATE pr_review_analysis_jobs/);
  assert.match(database.calls[0].text, /UPDATE pr_review_sessions/);
}

{
  const recovery = new PrReviewAnalysisJobRecoveryService(new FakeDatabase());
  assert.equal(await recovery.recoverStaleJobs(), 0);
}

{
  const database = new FakeDatabase([
    { status: "queued", count: 2 },
    { status: "processing", count: "1" },
    { status: "failed", count: 3 }
  ]);
  const messages = [];
  const recovery = new PrReviewAnalysisJobRecoveryService(database);
  recovery.logger = { log: (message) => messages.push(message) };

  await recovery.logStatusCounts();

  assert.match(database.calls[0].text, /GROUP BY status/);
  assert.match(database.calls[0].text, /INTERVAL '24 hours'/);
  assert.deepEqual(messages, [
    'PR Review analysis status counts_24h={"queued":2,"processing":1,"failed":3}'
  ]);
}
