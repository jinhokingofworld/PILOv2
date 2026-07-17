import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as deliveryFlow from "./action-item-delivery-flow.ts";

const { saveThenDeliverActionItem } = deliveryFlow;

const deliveryOptions = {
  boards: [
    {
      id: "10",
      name: "PILO Project",
      columns: [
        { id: "100", name: "Todo" },
        { id: "101", name: "Done" }
      ]
    },
    {
      id: "20",
      name: "PILO Test Project",
      columns: [{ id: "200", name: "Todo" }]
    }
  ]
};

function hasSelection(boardId, columnId) {
  assert.equal(typeof deliveryFlow.hasPiloIssueDeliverySelection, "function");
  return deliveryFlow.hasPiloIssueDeliverySelection(
    deliveryOptions,
    boardId,
    columnId
  );
}

function resolveSelection(boardId, columnId) {
  assert.equal(
    typeof deliveryFlow.resolvePiloIssueDeliverySelection,
    "function"
  );
  return deliveryFlow.resolvePiloIssueDeliverySelection(
    deliveryOptions,
    boardId,
    columnId
  );
}

test("같은 Board의 실제 Column을 선택하면 Pilo issue 전달을 활성화한다", () => {
  assert.equal(hasSelection("10", "100"), true);
});

test("동기화 뒤 사라진 Board draft는 Pilo issue 전달을 비활성화한다", () => {
  assert.equal(hasSelection("30", "300"), false);
});

test("다른 Board의 Column을 조합한 draft는 Pilo issue 전달을 비활성화한다", () => {
  assert.equal(hasSelection("10", "200"), false);
});

test("Pilo issue 생성 대상이 없으면 전달을 비활성화한다", () => {
  assert.equal(typeof deliveryFlow.hasPiloIssueDeliveryTarget, "function");
  assert.equal(deliveryFlow.hasPiloIssueDeliveryTarget({ boards: [] }), false);
});

test("유효한 Board Column이 있으면 Pilo issue 전달을 활성화한다", () => {
  assert.equal(typeof deliveryFlow.hasPiloIssueDeliveryTarget, "function");
  assert.equal(
    deliveryFlow.hasPiloIssueDeliveryTarget({
      boards: [
        {
          id: "10",
          name: "PILO Project",
          columns: [{ id: "100", name: "Todo" }]
        }
      ]
    }),
    true
  );
});

test("새 eligibility 목록에서도 유효한 Pilo issue draft 선택을 유지한다", () => {
  assert.deepEqual(resolveSelection("10", "101"), {
    boardId: "10",
    columnId: "101"
  });
});

test("pending 신규 Pilo issue 선택은 첫 유효 대상을 기본값으로 사용한다", () => {
  assert.deepEqual(resolveSelection("", ""), {
    boardId: "10",
    columnId: "100"
  });
});

test("Pilo issue draft 선택이 stale이면 기존 선택을 유지해 생성 차단 상태를 보존한다", () => {
  assert.deepEqual(resolveSelection("30", "300"), {
    boardId: "30",
    columnId: "300"
  });
});

test("후속 작업 저장이 실패하면 외부 전달을 실행하지 않는다", async () => {
  const calls = [];

  const delivered = await saveThenDeliverActionItem({
    needsSave: true,
    save: async () => {
      calls.push("save");
      return false;
    },
    deliver: async () => {
      calls.push("deliver");
    }
  });

  assert.equal(delivered, false);
  assert.deepEqual(calls, ["save"]);
});

test("후속 작업 저장이 예외로 실패하면 외부 전달을 실행하지 않는다", async () => {
  const calls = [];

  await assert.rejects(
    saveThenDeliverActionItem({
      needsSave: true,
      save: async () => {
        calls.push("save");
        throw new Error("PATCH failed");
      },
      deliver: async () => {
        calls.push("deliver");
      }
    }),
    /PATCH failed/
  );

  assert.deepEqual(calls, ["save"]);
});

test("후속 작업 저장이 성공하면 저장 후 외부 전달을 실행한다", async () => {
  const calls = [];

  const delivered = await saveThenDeliverActionItem({
    needsSave: true,
    save: async () => {
      calls.push("save");
      return true;
    },
    deliver: async () => {
      calls.push("deliver");
    }
  });

  assert.equal(delivered, true);
  assert.deepEqual(calls, ["save", "deliver"]);
});

const reportSectionSource = await readFile(
  new URL("../components/meeting-report-section.tsx", import.meta.url),
  "utf8"
);

function sliceFunctionSource(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);

  assert.notEqual(startIndex, -1, `${startMarker} 함수 시작을 찾을 수 없습니다.`);
  assert.notEqual(endIndex, -1, `${endMarker} 함수 시작을 찾을 수 없습니다.`);

  return source.slice(startIndex, endIndex);
}

test("Pilo issue option loader는 캐시와 무관하게 매 호출마다 최신 목록을 요청한다", () => {
  const loaderSource = sliceFunctionSource(
    reportSectionSource,
    "  async function loadIssueDeliveryOptions(",
    "  async function selectDeliveryType("
  );

  assert.match(loaderSource, /await onLoadIssueDeliveryOptions\(\)/);
  assert.doesNotMatch(loaderSource, /\bissueOptions\b/);
});

test("Pilo issue 대상이 없으면 repository 연결과 ProjectV2 동기화를 안내한다", () => {
  assert.match(
    reportSectionSource,
    /GitHub repository 연결과 metadata를 확인하고 ProjectV2 Board를 동기화한 뒤 다시 시도해주세요\./
  );
  assert.match(reportSectionSource, /hasPiloIssueDeliveryTarget/);
});

test("stale Pilo issue 선택이면 repository 연결과 ProjectV2 동기화를 안내한다", () => {
  assert.match(reportSectionSource, /hasPiloIssueDeliverySelection/);
  assert.match(
    reportSectionSource,
    /GitHub repository 연결과 metadata를 확인하고 ProjectV2 Board와 Column을 동기화한 뒤 다시 시도해주세요\./
  );
});

test("DELIVERY_FAILED Pilo issue draft를 다시 열면 최신 eligibility 목록을 다시 불러온다", () => {
  assert.match(
    reportSectionSource,
    /draft\?\.deliveryType === "pilo_issue"[\s\S]{0,500}setSelectedBoardId\(draft\.issue\.boardId\)/
  );
  assert.match(reportSectionSource, /async function beginEditing\(\)[\s\S]{0,300}await loadIssueDeliveryOptions\(\)/);
});

test("현재 Board와 Column 선택이 유효하지 않으면 생성 버튼을 비활성화한다", () => {
  assert.match(
    reportSectionSource,
    /:\s*!hasIssueDeliverySelection/
  );
});
