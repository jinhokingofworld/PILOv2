import assert from "node:assert/strict";
import test from "node:test";

import {
  orderBoardColumns,
  resolveMobileBoardColumnId
} from "./utils/board-presentation.ts";

test("Unmapped를 첫 번째로 두고 나머지 순서를 유지한다", () => {
  const columns = [
    { id: "todo", normalizedName: "todo", position: 0 },
    { id: "done", normalizedName: "done", position: 1 },
    { id: "unmapped", normalizedName: "unmapped", position: 2 }
  ];

  assert.deepEqual(
    orderBoardColumns(columns).map(({ id }) => id),
    ["unmapped", "todo", "done"]
  );
  assert.deepEqual(
    columns.map(({ id }) => id),
    ["todo", "done", "unmapped"]
  );
});

test("선택 컬럼이 사라지면 첫 컬럼으로 복구한다", () => {
  const columns = [{ id: "unmapped", normalizedName: "unmapped" }];

  assert.equal(
    resolveMobileBoardColumnId(columns, "removed"),
    "unmapped"
  );
});

test("선택 컬럼이 남아 있으면 선택을 유지하고 빈 목록은 빈 값을 반환한다", () => {
  const columns = [
    { id: "unmapped", normalizedName: "unmapped" },
    { id: "done", normalizedName: "done" }
  ];

  assert.equal(resolveMobileBoardColumnId(columns, "done"), "done");
  assert.equal(resolveMobileBoardColumnId([], "done"), "");
});
