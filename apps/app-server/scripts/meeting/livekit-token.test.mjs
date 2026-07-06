import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { LiveKitTokenService } = require(
  "../../dist/modules/meeting/livekit-token.service.js"
);

const originalEnv = {
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_URL: process.env.LIVEKIT_URL
};

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

try {
  process.env.LIVEKIT_API_KEY = "test-api-key";
  process.env.LIVEKIT_API_SECRET = "dummy-livekit-signing-key";
  process.env.LIVEKIT_URL = "wss://livekit.example.test";

  const service = new LiveKitTokenService();
  const result = await service.createJoinToken({
    livekitRoomName: "meeting-room-1",
    livekitIdentity: "meeting-room-1-user-1",
    participantName: "Jinho"
  });
  const payload = decodeJwtPayload(result.livekitToken);

  assert.equal(result.livekitRoomName, "meeting-room-1");
  assert.equal(result.livekitIdentity, "meeting-room-1-user-1");
  assert.equal(result.livekitUrl, "wss://livekit.example.test");
  assert.equal(typeof result.expiresAt, "string");
  assert.equal(payload.sub, "meeting-room-1-user-1");
  assert.equal(payload.name, "Jinho");
  assert.equal(payload.video.room, "meeting-room-1");
  assert.equal(payload.video.roomJoin, true);
  assert.equal(payload.video.canPublish, true);
  assert.equal(payload.video.canSubscribe, true);
  assert.equal(payload.video.canPublishData, false);
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.equal("roomRecord" in payload.video, false);
  assert.equal("roomAdmin" in payload.video, false);
  assert.equal("sip" in payload, false);

  delete process.env.LIVEKIT_API_KEY;
  await assert.rejects(
    () =>
      service.createJoinToken({
        livekitRoomName: "meeting-room-1",
        livekitIdentity: "meeting-room-1-user-1",
        participantName: null
      }),
    /LiveKit is not configured/
  );
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

  if (originalEnv.LIVEKIT_URL === undefined) {
    delete process.env.LIVEKIT_URL;
  } else {
    process.env.LIVEKIT_URL = originalEnv.LIVEKIT_URL;
  }
}
