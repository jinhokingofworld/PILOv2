import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { EncodedFileType, EgressStatus } = require("livekit-server-sdk");
const { LiveKitEgressService } = require(
  "../../dist/modules/meeting/livekit-egress.service.js"
);

const originalEnv = {
  AWS_REGION: process.env.AWS_REGION,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_EGRESS_S3_PREFIX: process.env.LIVEKIT_EGRESS_S3_PREFIX,
  LIVEKIT_RECORDING_MODE: process.env.LIVEKIT_RECORDING_MODE,
  LIVEKIT_RECORDINGS_BUCKET: process.env.LIVEKIT_RECORDINGS_BUCKET,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  LIVEKIT_WS_URL: process.env.LIVEKIT_WS_URL
};

class FakeEgressClient {
  constructor() {
    this.startCalls = [];
    this.stopCalls = [];
    this.startResponse = {
      egressId: "egress-1"
    };
    this.stopResponse = {
      status: EgressStatus.EGRESS_COMPLETE,
      fileResults: [
        {
          filename: "recordings/meetings/workspaces/ws/meetings/mt/recordings/rec.mp3",
          duration: 120_000_000_000n,
          size: 4096n
        }
      ]
    };
  }

  async startRoomCompositeEgress(roomName, output, options) {
    this.startCalls.push({ roomName, output, options });
    return this.startResponse;
  }

  async stopEgress(egressId) {
    this.stopCalls.push({ egressId });
    return this.stopResponse;
  }
}

class TestLiveKitEgressService extends LiveKitEgressService {
  constructor(client) {
    super();
    this.client = client;
    this.configs = [];
  }

  createEgressClient(config) {
    this.configs.push(config);
    return this.client;
  }
}

try {
  process.env.AWS_REGION = "ap-northeast-2";
  process.env.LIVEKIT_API_KEY = "test-api-key";
  process.env.LIVEKIT_API_SECRET = "dummy-livekit-signing-key";
  process.env.LIVEKIT_EGRESS_S3_PREFIX = "recordings/meetings";
  process.env.LIVEKIT_RECORDING_MODE = "room_audio_only";
  process.env.LIVEKIT_RECORDINGS_BUCKET = "pilo-recordings";
  process.env.LIVEKIT_URL = "wss://livekit.example.test";
  process.env.LIVEKIT_WS_URL = "wss://livekit-internal.example.test";

  {
    const client = new FakeEgressClient();
    const service = new TestLiveKitEgressService(client);
    const result = await service.startRoomAudioOnlyEgress({
      livekitRoomName: "meeting-room",
      audioFileKey:
        "recordings/meetings/workspaces/ws/meetings/mt/recordings/rec.mp3"
    });

    assert.deepEqual(result, {
      livekitEgressId: "egress-1"
    });
    assert.equal(
      service.configs[0].livekitApiUrl,
      "https://livekit-internal.example.test"
    );
    assert.equal(client.startCalls.length, 1);
    assert.equal(client.startCalls[0].roomName, "meeting-room");
    assert.equal(client.startCalls[0].options.audioOnly, true);
    assert.equal(client.startCalls[0].output.fileType, EncodedFileType.MP3);
    assert.equal(client.startCalls[0].output.output.case, "s3");
    assert.equal(client.startCalls[0].output.output.value.bucket, "pilo-recordings");
    assert.equal(client.startCalls[0].output.output.value.region, "ap-northeast-2");
    assert.equal(client.startCalls[0].output.output.value.accessKey, "");
    assert.equal(client.startCalls[0].output.output.value.secret, "");
  }

  {
    const client = new FakeEgressClient();
    const service = new TestLiveKitEgressService(client);
    const result = await service.stopEgress("egress-1");

    assert.equal(client.stopCalls[0].egressId, "egress-1");
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.durationSec, 120);
    assert.equal(result.fileSizeBytes, 4096);
    assert.equal(result.errorMessage, null);
  }

  {
    const client = new FakeEgressClient();
    client.stopResponse = {
      status: EgressStatus.EGRESS_FAILED,
      fileResults: []
    };
    const service = new TestLiveKitEgressService(client);
    const result = await service.stopEgress("egress-1");

    assert.equal(result.status, "FAILED");
    assert.equal(result.errorMessage, "LiveKit Egress failed");
  }

  {
    delete process.env.LIVEKIT_RECORDINGS_BUCKET;
    const service = new TestLiveKitEgressService(new FakeEgressClient());

    await assert.rejects(
      () =>
        service.startRoomAudioOnlyEgress({
          livekitRoomName: "meeting-room",
          audioFileKey: "recordings/rec.mp3"
        }),
      /LiveKit Egress is not configured/
    );
  }

  {
    process.env.LIVEKIT_RECORDINGS_BUCKET = "pilo-recordings";
    delete process.env.LIVEKIT_WS_URL;
    const service = new TestLiveKitEgressService(new FakeEgressClient());

    await service.startRoomAudioOnlyEgress({
      livekitRoomName: "meeting-room",
      audioFileKey: "recordings/rec.mp3"
    });

    assert.equal(service.configs[0].livekitApiUrl, "https://livekit.example.test");
  }

  {
    process.env.LIVEKIT_RECORDING_MODE = "track_composite";
    const service = new TestLiveKitEgressService(new FakeEgressClient());

    await assert.rejects(
      () =>
        service.startRoomAudioOnlyEgress({
          livekitRoomName: "meeting-room",
          audioFileKey: "recordings/rec.mp3"
        }),
      /LiveKit Egress is not configured/
    );
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
