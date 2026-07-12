import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MeetingReportOutboxPublisherService
} = require("../../dist/modules/meeting/meeting-report-outbox-publisher.service.js");
const {
  MeetingReportOutboxRecoveryService
} = require("../../dist/modules/meeting/meeting-report-outbox-recovery.service.js");

const claim = {
  id: "11111111-1111-1111-1111-111111111111",
  report_id: "22222222-2222-2222-2222-222222222222",
  meeting_id: "33333333-3333-3333-3333-333333333333",
  recording_id: "44444444-4444-4444-4444-444444444444",
  audio_file_key: "recordings/meeting.mp3",
  attempt_count: 1,
  claim_token: "55555555-5555-5555-5555-555555555555"
};

class FakeOutboxDatabase {
  constructor({ dueRows = [], claimRow = null, recoveryCandidates = [], lockAcquired = true } = {}) {
    this.dueRows = dueRows;
    this.claimRow = claimRow;
    this.recoveryCandidates = recoveryCandidates;
    this.lockAcquired = lockAcquired;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });

    return this.dueRows;
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    return callback({
      query: async (text, values = []) => {
        this.calls.push({ method: "transaction.query", text, values });
        return this.recoveryCandidates;
      },
      queryOne: async (text, values = []) => {
        this.calls.push({ method: "queryOne", text, values });
        if (text.includes("pg_try_advisory_lock")) {
          return { acquired: this.lockAcquired };
        }
        if (text.includes("UPDATE meeting_reports")) {
          return this.lockAcquired ? { id: claim.report_id } : null;
        }
        return this.claimRow;
      },
      execute: async (text, values = []) => {
        this.calls.push({ method: "transaction.execute", text, values });
        return { rows: [] };
      }
    });
  }
}

class FakeMeetingReportJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.jobs = [];
  }

  async enqueueMeetingReportJob(job) {
    this.jobs.push(job);
    if (this.shouldFail) throw new Error("SQS unavailable");
  }
}

class FakeMeetingReportRealtimePublisher {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.reportIds = [];
  }

  async publishReportUpdatedSafely(reportId) {
    this.reportIds.push(reportId);
    if (this.shouldFail) throw new Error("Redis unavailable");
  }
}

{
  const database = new FakeOutboxDatabase({
    dueRows: [{ id: claim.id }],
    claimRow: claim
  });
  const jobService = new FakeMeetingReportJobService();
  const publisher = new MeetingReportOutboxPublisherService(database, jobService);

  await publisher.publishDue();

  assert.deepEqual(jobService.jobs, [{
    jobType: "meeting_report",
    reportId: claim.report_id,
    meetingId: claim.meeting_id,
    recordingId: claim.recording_id,
    audioFileKey: claim.audio_file_key,
    retryCount: 0
  }]);
  assert.match(
    database.calls.find((call) => call.method === "queryOne").text,
    /FOR UPDATE SKIP LOCKED/
  );
  const delivered = database.calls.find(
    (call) => call.method === "execute" && call.text.includes("delivered_at = now()")
  );
  assert.match(delivered.text, /SET status = 'delivered'/);
  assert.deepEqual(delivered.values, [claim.id, claim.claim_token]);
}

{
  const database = new FakeOutboxDatabase({
    dueRows: [{ id: claim.id }],
    claimRow: claim
  });
  const publisher = new MeetingReportOutboxPublisherService(
    database,
    new FakeMeetingReportJobService({ shouldFail: true })
  );

  await publisher.publishDue();

  const retry = database.calls.find(
    (call) => call.method === "execute" && call.text.includes("next_attempt_at = $2")
  );
  assert.match(retry.text, /error_code = 'MEETING_REPORT_ENQUEUE_FAILED'/);
  assert.match(retry.text, /error_message = 'Meeting report job could not be enqueued'/);
  assert.equal(retry.values[2], claim.claim_token);
  assert.ok(retry.values[1] instanceof Date);
}

{
  const database = new FakeOutboxDatabase({
    dueRows: [{ id: claim.id }],
    claimRow: { ...claim, attempt_count: 6 }
  });
  const realtimePublisher = new FakeMeetingReportRealtimePublisher();
  const publisher = new MeetingReportOutboxPublisherService(
    database,
    new FakeMeetingReportJobService({ shouldFail: true }),
    realtimePublisher
  );

  await publisher.publishDue();

  assert.match(
    database.calls.find(
      (call) => call.method === "queryOne" && call.text.includes("SET status = 'failed'")
    ).text,
    /SET status = 'failed'/
  );
  assert.match(
    database.calls.find(
      (call) => call.method === "queryOne" && call.text.includes("SET status = 'FAILED'")
    ).text,
    /SET status = 'FAILED'/
  );
  assert.deepEqual(realtimePublisher.reportIds, [claim.report_id]);
}

{
  const database = new FakeOutboxDatabase({
    recoveryCandidates: [{
      id: claim.report_id,
      meeting_id: claim.meeting_id,
      recording_id: claim.recording_id,
      outbox_id: claim.id
    }]
  });
  const realtimePublisher = new FakeMeetingReportRealtimePublisher();
  const recovery = new MeetingReportOutboxRecoveryService(database, realtimePublisher);

  assert.equal(await recovery.recoverStaleReports(), 1);
  assert.deepEqual(realtimePublisher.reportIds, [claim.report_id]);
  const query = database.calls.find((call) => call.method === "transaction.query");
  assert.match(query.text, /outbox.status = 'delivered'/);
  assert.match(query.text, /FOR UPDATE OF report, outbox SKIP LOCKED/);
  assert.match(
    database.calls.find((call) => call.text?.includes("pg_try_advisory_lock")).text,
    /pg_try_advisory_lock/
  );
  assert.match(
    database.calls.find((call) => call.text?.includes("pg_advisory_unlock")).text,
    /pg_advisory_unlock/
  );
}

{
  const database = new FakeOutboxDatabase({
    recoveryCandidates: [{
      id: claim.report_id,
      meeting_id: claim.meeting_id,
      recording_id: claim.recording_id,
      outbox_id: claim.id
    }],
    lockAcquired: false
  });
  const recovery = new MeetingReportOutboxRecoveryService(database);

  assert.equal(await recovery.recoverStaleReports(), 0);
  assert.equal(
    database.calls.some((call) => call.text?.includes("UPDATE meeting_reports")),
    false
  );
}

{
  const originalRuntime = process.env.APP_SERVER_RUNTIME;
  process.env.APP_SERVER_RUNTIME = "github-sync-worker";
  const database = new FakeOutboxDatabase();
  const publisher = new MeetingReportOutboxPublisherService(
    database,
    new FakeMeetingReportJobService()
  );
  const recovery = new MeetingReportOutboxRecoveryService(database);

  publisher.onModuleInit();
  recovery.onModuleInit();
  await Promise.resolve();
  assert.equal(database.calls.length, 0);

  if (originalRuntime === undefined) delete process.env.APP_SERVER_RUNTIME;
  else process.env.APP_SERVER_RUNTIME = originalRuntime;
}
