import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MeetingReportJobService } = require(
  "../../dist/modules/meeting/meeting-report-job.service.js"
);

const originalEnv = {
  AWS_REGION: process.env.AWS_REGION,
  SQS_MEETING_REPORT_JOBS_QUEUE_URL: process.env.SQS_MEETING_REPORT_JOBS_QUEUE_URL,
  SQS_ENDPOINT: process.env.SQS_ENDPOINT
};

const payload = {
  jobType: "meeting_report",
  reportId: "77777777-7777-7777-7777-777777777777",
  meetingId: "33333333-3333-3333-3333-333333333333",
  recordingId: "55555555-5555-5555-5555-555555555555",
  audioFileKey:
    "recordings/meetings/workspaces/ws/meetings/mt/recordings/rec.mp3",
  retryCount: 0
};

class FakeSqsClient {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.commands = [];
    this.destroyCalls = 0;
  }

  async send(command) {
    this.commands.push(command);

    if (this.shouldFail) {
      throw new Error("raw AWS queue failure with queue url");
    }

    return {
      MessageId: "message-1"
    };
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class TestMeetingReportJobService extends MeetingReportJobService {
  constructor(client) {
    super();
    this.client = client;
    this.configs = [];
  }

  createSqsClient(config) {
    this.configs.push(config);
    return this.client;
  }
}

try {
  process.env.AWS_REGION = "ap-northeast-2";
  process.env.SQS_MEETING_REPORT_JOBS_QUEUE_URL =
    "http://localhost:4566/000000000000/pilo-dev-ai-jobs";
  process.env.SQS_ENDPOINT = "http://localhost:4566";

  {
    const client = new FakeSqsClient();
    const service = new TestMeetingReportJobService(client);

    await service.enqueueMeetingReportJob(payload);
    await service.enqueueMeetingReportJob({
      ...payload,
      retryCount: 1
    });

    assert.deepEqual(service.configs, [
      {
        awsRegion: "ap-northeast-2",
        queueUrl: "http://localhost:4566/000000000000/pilo-dev-ai-jobs",
        endpoint: "http://localhost:4566"
      }
    ]);
    assert.equal(client.commands.length, 2);
    assert.equal(client.commands[0].constructor.name, "SendMessageCommand");
    assert.equal(
      client.commands[0].input.QueueUrl,
      "http://localhost:4566/000000000000/pilo-dev-ai-jobs"
    );
    assert.deepEqual(JSON.parse(client.commands[0].input.MessageBody), payload);
    assert.deepEqual(
      JSON.parse(client.commands[1].input.MessageBody),
      {
        ...payload,
        retryCount: 1
      }
    );
    assert.equal(client.commands[0].input.MessageGroupId, undefined);
    assert.equal(client.commands[0].input.MessageDeduplicationId, undefined);

    service.onModuleDestroy();
    assert.equal(client.destroyCalls, 1);
  }

  {
    delete process.env.SQS_MEETING_REPORT_JOBS_QUEUE_URL;
    const client = new FakeSqsClient();
    const service = new TestMeetingReportJobService(client);

    try {
      await service.enqueueMeetingReportJob(payload);
      assert.fail("Expected missing SQS queue config failure");
    } catch (error) {
      assert.equal(error.getStatus(), 400);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Meeting report job queue is not configured"
        }
      });
    }
    assert.equal(client.commands.length, 0);
    assert.equal(service.configs.length, 0);
  }

  {
    process.env.SQS_MEETING_REPORT_JOBS_QUEUE_URL =
      "http://localhost:4566/000000000000/pilo-dev-ai-jobs";
    const client = new FakeSqsClient({ shouldFail: true });
    const service = new TestMeetingReportJobService(client);

    try {
      await service.enqueueMeetingReportJob(payload);
      assert.fail("Expected SQS publish failure");
    } catch (error) {
      assert.equal(error.getStatus(), 400);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Meeting report job could not be enqueued"
        }
      });
      assert.doesNotMatch(
        JSON.stringify(error.getResponse()),
        /raw AWS queue failure|pilo-dev-ai-jobs/
      );
    }
  }
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
