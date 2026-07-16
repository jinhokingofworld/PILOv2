import assert from "node:assert/strict";
import test from "node:test";

import { createPdfCollaborationRoomState } from "./pdf-collaboration-room-state.ts";

const room = {
  fileId: "00000000-0000-0000-0000-000000000002",
  workspaceId: "00000000-0000-0000-0000-000000000001",
};

test("deletes an ephemeral room after its last participant leaves", () => {
  const state = createPdfCollaborationRoomState();
  const firstSocketId = "socket-a";
  const secondSocketId = "socket-b";

  state.join(room, firstSocketId, {
    displayName: "EJ",
    pageNumber: 1,
    userId: "00000000-0000-0000-0000-000000000003",
  });
  state.join(room, secondSocketId, {
    displayName: "JH",
    pageNumber: 3,
    userId: "00000000-0000-0000-0000-000000000004",
  });

  state.commitStroke(room, {
    color: "#111827",
    id: "stroke-a",
    pageNumber: 1,
    points: [
      { xRatio: 0.1, yRatio: 0.1 },
      { xRatio: 0.2, yRatio: 0.2 },
    ],
    tool: "pen",
  });

  state.leave(room, firstSocketId);
  assert.deepEqual(state.getSnapshot(room)?.strokesByPage[1]?.map((stroke) => stroke.id), ["stroke-a"]);
  assert.equal(state.getSnapshot(room)?.presence.length, 1);

  state.leave(room, secondSocketId);
  assert.equal(state.getSnapshot(room), null);
});
