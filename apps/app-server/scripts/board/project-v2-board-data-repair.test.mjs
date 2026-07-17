import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildColumnMap,
  hashBoardIssueRequest,
  planBoardRepair
} from "./project-v2-board-data-repair-lib.mjs";

const legacyColumns = [
  { id: "11", boardId: "10", name: "Todo", statusOptionGithubId: "todo" },
  { id: "12", boardId: "10", name: "Unmapped", statusOptionGithubId: null }
];
const canonicalColumns = [
  { id: "21", boardId: "20", name: "Todo renamed", statusOptionGithubId: "todo" },
  { id: "22", boardId: "20", name: "Unmapped", statusOptionGithubId: null }
];

function delivery(overrides = {}) {
  return {
    id: "delivery-1",
    actionItemId: "action-1",
    workspaceId: "workspace-1",
    deliveryType: "pilo_issue",
    status: "FAILED",
    actionItemStatus: "DELIVERY_FAILED",
    piloIssueId: null,
    calendarEventId: null,
    targetResourceId: null,
    requestedByUserId: "actor-1",
    actionItemTitle: "Action title",
    actionItemDescription: "Action description",
    idempotencyKey: "meeting:key-1",
    draftJson: {
      issue: { boardId: "10", columnId: "11", title: "Title", body: "Body" }
    },
    ...overrides
  };
}

function operation(overrides = {}) {
  return {
    id: "operation-1",
    workspaceId: "workspace-1",
    actorUserId: "actor-1",
    boardId: "10",
    columnId: "11",
    idempotencyKey: "meeting:key-1",
    requestTitle: "Title",
    requestBody: "Body",
    requestHash: hashBoardIssueRequest({ boardId: "10", columnId: "11", title: "Title", body: "Body" }),
    status: "retryable",
    completedStage: "none",
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    boards: [
      { id: "10", canonicalBoardId: "20", referenceCount: 1 },
      { id: "13", canonicalBoardId: "20", referenceCount: 0 },
      { id: "20", canonicalBoardId: "20", referenceCount: 2 }
    ],
    columns: [...legacyColumns, ...canonicalColumns],
    deliveries: [delivery()],
    operations: [operation()],
    ...overrides
  };
}

const expectations = {
  expectedDeliveryUpdates: 1,
  expectedOperationUpdates: 1,
  expectedBoardDeletes: 1
};

test("hash matches the production JSON field order and null body handling", () => {
  assert.equal(
    hashBoardIssueRequest({ boardId: "20", columnId: "21", title: "Title", body: "Body" }),
    "a6abad759ea6d50b9587febf6ef5632a2a3c26fadb5a60975b4e709029b94bd3"
  );
  assert.notEqual(
    hashBoardIssueRequest({ boardId: "20", columnId: "21", title: "Title" }),
    hashBoardIssueRequest({ boardId: "20", columnId: "21", title: "Title", body: "" })
  );
});

test("columns map by GitHub Status identity and the unique null Unmapped sentinel", () => {
  const map = buildColumnMap({ legacyColumns, canonicalColumns });
  assert.deepEqual([...map.entries()], [["11", "21"], ["12", "22"]]);
});

test("duplicate or missing Status identities are rejected", () => {
  assert.throws(() => buildColumnMap({
    legacyColumns,
    canonicalColumns: [...canonicalColumns, { ...canonicalColumns[0], id: "23" }]
  }), /duplicate canonical Status option/);
  assert.throws(() => buildColumnMap({
    legacyColumns,
    canonicalColumns: canonicalColumns.slice(0, 1)
  }), /Unmapped/);
});

test("plans only eligible failed deliveries and their exact retryable operation", () => {
  const plan = planBoardRepair(snapshot(), expectations);
  assert.deepEqual(plan.deliveryUpdates, [{ deliveryId: "delivery-1", boardId: "20", columnId: "21" }]);
  assert.equal(plan.operationUpdates[0].operationId, "operation-1");
  assert.equal(plan.operationUpdates[0].boardId, "20");
  assert.equal(plan.operationUpdates[0].columnId, "21");
  assert.equal(plan.operationUpdates[0].requestHash,
    hashBoardIssueRequest({ boardId: "20", columnId: "21", title: "Title", body: "Body" }));
  assert.deepEqual(plan.retainedBoardIds.sort(), ["10", "20"]);
  assert.deepEqual(plan.deletableBoardIds, ["13"]);
  assert.deepEqual(plan.counts, { deliveryUpdates: 1, operationUpdates: 1, boardDeletes: 1 });
});

test("completed audit history, Calendar deliveries, and succeeded operations stay immutable", () => {
  const ignored = [
    delivery({ id: "completed", status: "COMPLETED", actionItemStatus: "APPROVED", targetResourceId: "99" }),
    delivery({ id: "calendar", deliveryType: "calendar_event" })
  ];
  const plan = planBoardRepair(snapshot({
    deliveries: [delivery(), ...ignored],
    operations: [operation(), operation({ id: "succeeded", idempotencyKey: "other", status: "succeeded", completedStage: "cache_persisted" })]
  }), expectations);
  assert.deepEqual(plan.deliveryUpdates.map((row) => row.deliveryId), ["delivery-1"]);
  assert.deepEqual(plan.operationUpdates.map((row) => row.operationId), ["operation-1"]);
});

test("target-bearing failures and non-DELIVERY_FAILED action items are ineligible", () => {
  for (const changed of [
    { piloIssueId: "1" }, { calendarEventId: "1" }, { targetResourceId: "1" },
    { actionItemStatus: "APPROVED" }
  ]) {
    const plan = planBoardRepair(snapshot({ deliveries: [delivery(changed)], operations: [] }), {
      expectedDeliveryUpdates: 0, expectedOperationUpdates: 0, expectedBoardDeletes: 1
    });
    assert.equal(plan.deliveryUpdates.length, 0);
  }
});

test("missing, duplicate, or mismatched operation linkage aborts", () => {
  assert.throws(() => planBoardRepair(snapshot({ operations: [] }), expectations), /exactly one linked operation/);
  assert.throws(() => planBoardRepair(snapshot({ operations: [operation(), operation({ id: "operation-2" })] }), expectations), /exactly one linked operation/);
  assert.throws(() => planBoardRepair(snapshot({ operations: [operation({ status: "succeeded" })] }), expectations), /retryable.*none/);
  assert.throws(() => planBoardRepair(snapshot({ operations: [operation({ requestTitle: "Different" })] }), expectations), /request payload/);
  assert.throws(() => planBoardRepair(snapshot({ operations: [operation({ requestHash: "corrupt" })] }), expectations), /existing request hash/);
  assert.throws(() => planBoardRepair(snapshot({ operations: [operation({ actorUserId: "actor-2" })] }), expectations), /request actor/);
  assert.throws(() => planBoardRepair(snapshot({ deliveries: [delivery({ requestedByUserId: null })] }), expectations), /request actor/);
});

test("missing draft title and body use the production Action Item fallback", () => {
  const fallbackDelivery = delivery({
    draftJson: { issue: { boardId: "10", columnId: "11" }, keep: { untouched: true } }
  });
  const fallbackOperation = operation({
    requestTitle: "Action title",
    requestBody: "Action description",
    requestHash: hashBoardIssueRequest({
      boardId: "10", columnId: "11", title: "Action title", body: "Action description"
    })
  });
  const plan = planBoardRepair(snapshot({ deliveries: [fallbackDelivery], operations: [fallbackOperation] }), expectations);
  assert.equal(plan.operationUpdates[0].requestHash, hashBoardIssueRequest({
    boardId: "20", columnId: "21", title: "Action title", body: "Action description"
  }));
});

test("exact expected counts abort and a second run is a no-op", () => {
  assert.throws(() => planBoardRepair(snapshot(), { ...expectations, expectedDeliveryUpdates: 2 }), /expected 2 delivery updates/);
  const alreadyRepaired = delivery({
    draftJson: { issue: { boardId: "20", columnId: "21", title: "Title", body: "Body" } }
  });
  const plan = planBoardRepair(snapshot({ deliveries: [alreadyRepaired], operations: [] }), {
    expectedDeliveryUpdates: 0, expectedOperationUpdates: 0, expectedBoardDeletes: 1
  });
  assert.equal(plan.deliveryUpdates.length, 0);
});

test("CLI and operator docs contain the mandatory safety contracts", async () => {
  const cli = await readFile(new URL("./project-v2-board-data-repair.mjs", import.meta.url), "utf8");
  const readme = await readFile(new URL("./README.md", import.meta.url), "utf8");
  assert.match(cli, /SERIALIZABLE/);
  assert.match(cli, /FOR UPDATE/);
  assert.match(cli, /--apply/);
  assert.match(cli, /--backup-path/);
  assert.match(cli, /--rollback/);
  assert.match(cli, /chmodSync\([^,]+, 0o600\)/);
  assert.match(cli, /ROLLBACK/);
  assert.match(cli, /COMMIT/);
  assert.match(cli, /jsonb_set/);
  assert.doesNotMatch(cli, /beforeDraftJson/);
  assert.match(cli, /before:\s*\{\s*boardId:/);
  assert.match(cli, /draft_json\s*=\s*jsonb_set\([\s\S]*jsonb_set\(draft_json/);
  assert.match(readme, /FAILED-only/i);
  assert.match(readme, /COMPLETED.*Calendar/is);
  assert.match(readme, /default.*rollback/is);
  assert.match(readme, /expected.*count.*abort/is);
  assert.match(readme, /DB owner.*approval/is);
});

test("Board domain runner registers only the optional focused PostgreSQL test", async () => {
  const runner = await readFile(new URL("./test.mjs", import.meta.url), "utf8");
  assert.match(runner, /if \(process\.env\.BOARD_POSTGRES_TEST_URL\)[\s\S]*project-v2-board-data-repair-postgres\.test\.mjs/);
});
