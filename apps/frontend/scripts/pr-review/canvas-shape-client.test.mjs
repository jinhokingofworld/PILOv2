import assert from "node:assert/strict";

const { createPrReviewApiClient } = await import(
  "../../src/features/pr-review/api/client.ts"
);

const requests = [];
const responses = [
  { id: "room-1", canvasId: "canvas-1" },
  [
    {
      id: "shape:pr-review-file:room-file-1",
      shapeType: "pr_review_file_node",
      revision: 3,
      rawShape: { props: { roomFileId: "room-file-1" } }
    }
  ],
  {
    id: "shape:pr-review-file:room-file-1",
    shapeType: "pr_review_file_node",
    revision: 3,
    rawShape: { props: { roomFileId: "room-file-1" } }
  },
  {
    id: "shape:pr-review-file:room-file-1",
    shapeType: "pr_review_file_node",
    revision: 4,
    rawShape: { props: { roomFileId: "room-file-1" } }
  }
];
const client = createPrReviewApiClient({
  accessToken: "token",
  baseUrl: "https://api.example.test",
  fetcher: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify({ success: true, data: responses[requests.length - 1] }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );
  }
});

await client.getReviewRoom("workspace-1", "room-1");
await client.listReviewCanvasShapes(
  "workspace-1",
  "canvas-1",
  { x: -100, y: -50, width: 1000, height: 800, margin: 400 }
);
await client.getReviewCanvasShape(
  "workspace-1",
  "shape:pr-review-file:room-file-1"
);
await client.updateReviewCanvasFileShape(
  "workspace-1",
  "shape:pr-review-file:room-file-1",
  {
    parentShapeId: null,
    x: 240,
    y: 180,
    width: 272,
    height: 116,
    zIndex: 10,
    rawShape: { props: { roomFileId: "room-file-1" } },
    baseRevision: 3,
    clientOperationId: "operation-1"
  }
);

assert.deepEqual(
  requests.map((request) => request.url),
  [
    "https://api.example.test/api/v1/workspaces/workspace-1/github/review-rooms/room-1",
    "https://api.example.test/api/v1/workspaces/workspace-1/canvases/canvas-1/shapes?x=-100&y=-50&width=1000&height=800&margin=400",
    "https://api.example.test/api/v1/workspaces/workspace-1/canvas-shapes/shape%3Apr-review-file%3Aroom-file-1",
    "https://api.example.test/api/v1/workspaces/workspace-1/canvas-shapes/shape%3Apr-review-file%3Aroom-file-1"
  ]
);
assert.equal(requests[3].init.method, "PATCH");
assert.deepEqual(JSON.parse(requests[3].init.body), {
  parentShapeId: null,
  x: 240,
  y: 180,
  width: 272,
  height: 116,
  zIndex: 10,
  rawShape: { props: { roomFileId: "room-file-1" } },
  baseRevision: 3,
  clientOperationId: "operation-1"
});
assert.equal(requests[3].init.headers.get("Authorization"), "Bearer token");

console.log("PR Review Canvas Shape client tests passed");
