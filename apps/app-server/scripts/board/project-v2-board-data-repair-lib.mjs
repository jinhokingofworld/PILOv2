import { createHash } from "node:crypto";

export function hashBoardIssueRequest({ boardId, columnId, title, body }) {
  return createHash("sha256")
    .update(JSON.stringify({ boardId, columnId, title, body: body ?? null }))
    .digest("hex");
}

function indexUnique(columns, label) {
  const index = new Map();
  for (const column of columns) {
    const key = column.statusOptionGithubId ?? null;
    if (index.has(key)) {
      const identity = key === null ? "Unmapped" : `Status option ${key}`;
      throw new Error(`duplicate ${label} ${identity}`);
    }
    index.set(key, column);
  }
  return index;
}

export function buildColumnMap({ legacyColumns, canonicalColumns }) {
  const legacy = indexUnique(legacyColumns, "legacy");
  const canonical = indexUnique(canonicalColumns, "canonical");
  const result = new Map();

  for (const [identity, source] of legacy) {
    const target = canonical.get(identity);
    if (!target) {
      const name = identity === null ? "Unmapped" : `Status option ${identity}`;
      throw new Error(`missing canonical ${name}`);
    }
    result.set(String(source.id), String(target.id));
  }
  return result;
}

function isEligibleDelivery(row) {
  return row.deliveryType === "pilo_issue"
    && row.status === "FAILED"
    && row.actionItemStatus === "DELIVERY_FAILED"
    && row.piloIssueId === null
    && row.calendarEventId === null
    && row.targetResourceId === null;
}

function assertExpected(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(`expected ${expected} ${description}, found ${actual}`);
  }
}

export function planBoardRepair(snapshot, expectations) {
  const boards = new Map(snapshot.boards.map((board) => [String(board.id), board]));
  const columnsByBoard = new Map();
  for (const column of snapshot.columns) {
    const key = String(column.boardId);
    const values = columnsByBoard.get(key) ?? [];
    values.push(column);
    columnsByBoard.set(key, values);
  }

  const deliveryUpdates = [];
  const operationUpdates = [];

  for (const row of snapshot.deliveries.filter(isEligibleDelivery)) {
    const issue = row.draftJson?.issue;
    if (!issue) throw new Error(`delivery ${row.id} has no issue draft`);
    const sourceBoard = boards.get(String(issue.boardId));
    if (!sourceBoard) throw new Error(`delivery ${row.id} references an unknown Board`);
    const canonicalBoardId = String(sourceBoard.canonicalBoardId);
    if (canonicalBoardId === String(issue.boardId)) continue;

    const columnMap = buildColumnMap({
      legacyColumns: columnsByBoard.get(String(issue.boardId)) ?? [],
      canonicalColumns: columnsByBoard.get(canonicalBoardId) ?? []
    });
    const canonicalColumnId = columnMap.get(String(issue.columnId));
    if (!canonicalColumnId) throw new Error(`delivery ${row.id} references an unmapped Column`);

    const linked = snapshot.operations.filter((candidate) =>
      candidate.workspaceId === row.workspaceId
      && candidate.idempotencyKey === row.idempotencyKey);
    if (linked.length !== 1) {
      throw new Error(`delivery ${row.id} must have exactly one linked operation`);
    }
    const operation = linked[0];
    if (!row.requestedByUserId || operation.actorUserId !== row.requestedByUserId) {
      throw new Error(`linked operation ${operation.id} request actor does not match the delivery requester`);
    }
    if (operation.status !== "retryable" || operation.completedStage !== "none") {
      throw new Error(`linked operation ${operation.id} must be retryable at completed_stage none`);
    }
    const effectiveTitle = issue.title ?? row.actionItemTitle;
    const effectiveBody = issue.body ?? row.actionItemDescription;
    if (String(operation.boardId) !== String(issue.boardId)
      || String(operation.columnId) !== String(issue.columnId)
      || operation.requestTitle !== effectiveTitle
      || (operation.requestBody ?? null) !== (effectiveBody ?? null)) {
      throw new Error(`linked operation ${operation.id} request payload does not match the delivery draft`);
    }
    const currentRequestHash = hashBoardIssueRequest({
      boardId: String(issue.boardId),
      columnId: String(issue.columnId),
      title: operation.requestTitle,
      body: operation.requestBody
    });
    if (operation.requestHash !== currentRequestHash) {
      throw new Error(`linked operation ${operation.id} existing request hash does not match its request payload`);
    }

    deliveryUpdates.push({
      deliveryId: String(row.id),
      boardId: canonicalBoardId,
      columnId: canonicalColumnId
    });
    operationUpdates.push({
      operationId: String(operation.id),
      boardId: canonicalBoardId,
      columnId: canonicalColumnId,
      requestHash: hashBoardIssueRequest({
        boardId: canonicalBoardId,
        columnId: canonicalColumnId,
        title: operation.requestTitle,
        body: operation.requestBody
      })
    });
  }

  const canonicalBoardIds = new Set(snapshot.boards.map((board) => String(board.canonicalBoardId)));
  const deletableBoardIds = snapshot.boards
    .filter((board) => !canonicalBoardIds.has(String(board.id)) && board.referenceCount === 0)
    .map((board) => String(board.id));
  const retainedBoardIds = snapshot.boards
    .filter((board) => canonicalBoardIds.has(String(board.id)) || board.referenceCount !== 0)
    .map((board) => String(board.id));

  assertExpected(deliveryUpdates.length, expectations.expectedDeliveryUpdates, "delivery updates");
  assertExpected(operationUpdates.length, expectations.expectedOperationUpdates, "operation updates");
  assertExpected(deletableBoardIds.length, expectations.expectedBoardDeletes, "Board deletes");

  return {
    deliveryUpdates,
    operationUpdates,
    retainedBoardIds,
    deletableBoardIds,
    counts: {
      deliveryUpdates: deliveryUpdates.length,
      operationUpdates: operationUpdates.length,
      boardDeletes: deletableBoardIds.length
    }
  };
}
