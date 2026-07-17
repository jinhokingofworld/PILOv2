import assert from "node:assert/strict";

const { createCanvasAccessService } = await import(
  "../src/canvas/room/canvas-access.service.ts"
);

function createDatabase(row) {
  return {
    async close() {},
    async execute() {
      throw new Error("execute should not be called");
    },
    async query() {
      throw new Error("query should not be called");
    },
    async queryOne(text, values) {
      assert.match(text, /JOIN workspace_members wm/);
      assert.match(text, /LEFT JOIN pr_review_rooms/);
      assert.match(text, /review_room\.status IN \('active', 'completed'\)/);
      assert.deepEqual(values, ["workspace-1", "canvas-1", "user-1"]);
      return row;
    }
  };
}

const context = { token: "session-token", userId: "user-1" };
const room = { workspaceId: "workspace-1", canvasId: "canvas-1" };

assert.deepEqual(
  await createCanvasAccessService(
    createDatabase({
      board_type: "freeform",
      engine_type: "classic",
      review_room_status: null
    })
  ).getCanvasRoomAccess(context, room),
  { boardType: "freeform", engineType: "classic", readOnly: false }
);
assert.deepEqual(
  await createCanvasAccessService(
    createDatabase({
      board_type: "review",
      engine_type: "classic",
      review_room_status: "active"
    })
  ).getCanvasRoomAccess(context, room),
  { boardType: "review", engineType: "classic", readOnly: false }
);
assert.deepEqual(
  await createCanvasAccessService(
    createDatabase({
      board_type: "review",
      engine_type: "classic",
      review_room_status: "completed"
    })
  ).getCanvasRoomAccess(context, room),
  { boardType: "review", engineType: "classic", readOnly: true }
);
assert.equal(
  await createCanvasAccessService(
    createDatabase({
      board_type: "review",
      engine_type: "classic",
      review_room_status: "unexpected"
    })
  ).getCanvasRoomAccess(context, room),
  null
);
assert.equal(
  await createCanvasAccessService(createDatabase(null)).getCanvasRoomAccess(
    context,
    room
  ),
  null
);
assert.equal(
  await createCanvasAccessService().getCanvasRoomAccess(
    { token: "session-token", userId: "" },
    room
  ),
  null
);

console.log("Realtime Review Canvas access tests passed");
