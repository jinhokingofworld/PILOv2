import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deliveryService = await readFile(
  new URL(
    "../../src/modules/meeting/meeting-action-item-delivery.service.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingApi = await readFile(
  new URL("../../../../docs/api/meeting-api.md", import.meta.url),
  "utf8"
);
const boardApi = await readFile(
  new URL("../../../../docs/api/board-api.md", import.meta.url),
  "utf8"
);

const methodStart = deliveryService.indexOf("async listIssueDeliveryOptions(");
const methodEnd = deliveryService.indexOf("private async prepareDelivery(", methodStart);
assert.notEqual(methodStart, -1);
assert.notEqual(methodEnd, -1);
const deliveryOptionsMethod = deliveryService.slice(methodStart, methodEnd);

assert.match(deliveryOptionsMethod, /this\.boardService\.listBoardDeliveryOptions/);
assert.doesNotMatch(
  deliveryOptionsMethod,
  /github_|project_v2|repository|oauth/i,
  "Meeting must consume the Board read model without inspecting provider metadata"
);
assert.match(
  meetingApi,
  /HTTP `200`[^\n]*`data: \{ "boards": \[\] \}`/
);
assert.match(meetingApi, /실제 Board issue 생성\s+직전 검증과 동일/);
assert.match(boardApi, /Board 이름으로 중복 제거하지 않는다/);

console.log("Meeting delivery options contract tests passed");
