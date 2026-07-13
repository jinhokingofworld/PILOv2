import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AccessToken } = require("livekit-server-sdk");
const { LiveKitWebhookService } = require(
  "../../dist/modules/meeting/livekit-webhook.service.js"
);

const apiKey = "livekit-webhook-test-key";
const apiSecret = "livekit-webhook-test-secret";
const deployLiveKitScript = await readFile(
  new URL("../../../../infra/scripts/deploy-dev-livekit.ps1", import.meta.url),
  "utf8"
);

assert.match(deployLiveKitScript, /\[string\]\$WebhookUrl/);
assert.match(deployLiveKitScript, /WEBHOOK_URL="\{\{WEBHOOK_URL\}\}"/);
assert.match(deployLiveKitScript, /LIVEKIT_WEBHOOK_URL=\$WEBHOOK_URL/);
assert.match(deployLiveKitScript, /webhook:\s*\n\s*urls:\s*\n\s*- "\$WEBHOOK_URL"/);

class FakeDatabase {
  constructor(rows = []) {
    this.rows = [...rows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    const next = this.rows.shift();
    return typeof next === "function" ? next(text, values) : (next ?? null);
  }

  async transaction(callback) {
    return callback(this);
  }
}

class FakeMeetingService {
  constructor() {
    this.reconciliationCalls = [];
    this.enqueueCalls = [];
    this.stateEventCalls = [];
  }

  async reconcileLiveKitParticipantDeparture(_transaction, input) {
    this.reconciliationCalls.push(input);
    return { job: null, stateEvents: [] };
  }

  async enqueueReconciledMeetingReportJob(job) {
    this.enqueueCalls.push(job);
  }

  async publishReconciledMeetingStateEvents(stateEvents) {
    this.stateEventCalls.push(stateEvents);
  }
}

function createSubject(database = new FakeDatabase()) {
  const meetingService = new FakeMeetingService();
  return {
    meetingService,
    service: new LiveKitWebhookService(database, meetingService)
  };
}

function deliveryRow(overrides = {}) {
  return {
    delivery_id: "event-1",
    event_name: "participant_left",
    status: "received",
    received_at: new Date("2026-07-11T00:00:00.000Z"),
    ...overrides
  };
}

function participantDepartureBody(overrides = {}) {
  return JSON.stringify({
    id: "event-1",
    event: "participant_left",
    room: {
      name: "meeting-1"
    },
    participant: {
      identity: "meeting-1-user-1"
    },
    createdAt: "1783728000",
    ...overrides
  });
}

async function signWebhookBody(body) {
  const token = new AccessToken(apiKey, apiSecret);
  token.sha256 = createHash("sha256").update(body).digest("base64");
  return token.toJwt();
}

async function assertApiError(action, status, message) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), status);
    assert.match(error.getResponse().error.message, message);
    return true;
  });
}

const originalEnv = {
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET
};

try {
  process.env.LIVEKIT_API_KEY = apiKey;
  process.env.LIVEKIT_API_SECRET = apiSecret;

  {
    const body = participantDepartureBody();
    const database = new FakeDatabase([null, deliveryRow()]);
    const { service, meetingService } = createSubject(database);

    const result = await service.receiveWebhook(
      Buffer.from(body),
      await signWebhookBody(body)
    );

    assert.deepEqual(result, {
      deliveryId: "event-1",
      eventName: "participant_left",
      status: "received",
      receivedAt: "2026-07-11T00:00:00.000Z",
      message: "LiveKit webhook received"
    });
    assert.match(database.queries[1].text, /INSERT INTO livekit_webhook_deliveries/);
    assert.deepEqual(database.queries[1].values, [
      "event-1",
      "participant_left",
      "meeting-1",
      "meeting-1-user-1",
      "received"
    ]);
    assert.deepEqual(meetingService.reconciliationCalls, [{
      roomName: "meeting-1",
      participantIdentity: "meeting-1-user-1",
      eventCreatedAt: new Date("2026-07-11T00:00:00.000Z")
    }]);
    assert.deepEqual(meetingService.enqueueCalls, [null]);
    assert.deepEqual(meetingService.stateEventCalls, [[]]);
  }

  {
    const body = participantDepartureBody();
    const database = new FakeDatabase([deliveryRow()]);
    const { service, meetingService } = createSubject(database);

    const result = await service.receiveWebhook(
      Buffer.from(body),
      await signWebhookBody(body)
    );

    assert.equal(result.status, "received");
    assert.equal(database.queries.length, 1);
    assert.equal(meetingService.reconciliationCalls.length, 0);
  }

  {
    const body = participantDepartureBody({
      id: "event-aborted",
      event: "participant_connection_aborted"
    });
    const database = new FakeDatabase([
      null,
      deliveryRow({
        delivery_id: "event-aborted",
        event_name: "participant_connection_aborted"
      })
    ]);
    const { service, meetingService } = createSubject(database);

    const result = await service.receiveWebhook(
      Buffer.from(body),
      await signWebhookBody(body)
    );

    assert.equal(result.status, "received");
    assert.equal(result.eventName, "participant_connection_aborted");
    assert.equal(meetingService.reconciliationCalls.length, 1);
  }

  {
    const body = participantDepartureBody({
      id: "event-race"
    });
    const database = new FakeDatabase([
      null,
      null,
      deliveryRow({
        delivery_id: "event-race"
      })
    ]);
    const { service } = createSubject(database);

    const result = await service.receiveWebhook(
      Buffer.from(body),
      await signWebhookBody(body)
    );

    assert.equal(result.deliveryId, "event-race");
    assert.equal(database.queries.length, 3);
    assert.match(database.queries[1].text, /ON CONFLICT \(delivery_id\) DO NOTHING/);
  }

  {
    const body = participantDepartureBody({
      id: "event-ignored",
      event: "room_started"
    });
    const database = new FakeDatabase([
      null,
      deliveryRow({
        delivery_id: "event-ignored",
        event_name: "room_started",
        status: "ignored"
      })
    ]);
    const { service, meetingService } = createSubject(database);

    const result = await service.receiveWebhook(
      Buffer.from(body),
      await signWebhookBody(body)
    );

    assert.equal(result.status, "ignored");
    assert.equal(result.message, "Unsupported LiveKit webhook event ignored");
    assert.equal(meetingService.reconciliationCalls.length, 0);
  }

  {
    const body = participantDepartureBody({
      providerError: "provider-raw-secret"
    });
    const database = new FakeDatabase();
    const { service } = createSubject(database);

    await assert.rejects(
      () => service.receiveWebhook(Buffer.from(body), undefined),
      (error) => {
        assert.equal(error.getStatus(), 401);
        assert.match(error.getResponse().error.message, /Invalid LiveKit webhook signature/);
        assert.doesNotMatch(
          JSON.stringify(error.getResponse()),
          /provider-raw-secret/
        );
        return true;
      }
    );
    assert.equal(database.queries.length, 0);
  }

  {
    const database = new FakeDatabase();
    const { service } = createSubject(database);

    await assertApiError(
      () => service.receiveWebhook(Buffer.from("not-json"), "irrelevant"),
      400,
      /payload must be JSON/
    );
    assert.equal(database.queries.length, 0);
  }
} finally {
  if (originalEnv.LIVEKIT_API_KEY === undefined) {
    delete process.env.LIVEKIT_API_KEY;
  } else {
    process.env.LIVEKIT_API_KEY = originalEnv.LIVEKIT_API_KEY;
  }

  if (originalEnv.LIVEKIT_API_SECRET === undefined) {
    delete process.env.LIVEKIT_API_SECRET;
  } else {
    process.env.LIVEKIT_API_SECRET = originalEnv.LIVEKIT_API_SECRET;
  }
}
