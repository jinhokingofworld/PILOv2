import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createBoardWorkspaceLocation,
  getBoardScrollOffset,
  readBoardWorkspaceTarget,
  waitForBoardScrollTarget,
} from "./board-workspace-location.ts";

const metrics = {
  clientHeight: 400,
  clientWidth: 600,
  scrollHeight: 1_200,
  scrollLeft: 600,
  scrollTop: 400,
  scrollWidth: 1_800,
};

test("Board kanban 위치는 board와 스크롤 비율만 capture한다", () => {
  const location = createBoardWorkspaceLocation(
    { boardId: "board-1", issueId: null, surface: "board-kanban" },
    metrics,
  );

  assert.deepEqual(location?.context, { boardId: "board-1", issueId: null });
  assert.equal(location?.route.search, "?boardId=board-1");
  assert.deepEqual(location?.viewport, {
    kind: "element",
    key: "board-kanban",
    xRatio: 0.5,
    yRatio: 0.5,
  });
});

test("Board issue sheet 위치는 선택 issue와 내부 세로 스크롤을 capture한다", () => {
  const location = createBoardWorkspaceLocation(
    {
      boardId: "board/other",
      issueId: "issue-7",
      surface: "board-issue-sheet",
    },
    { ...metrics, scrollLeft: 0 },
  );

  assert.deepEqual(location?.context, {
    boardId: "board/other",
    issueId: "issue-7",
  });
  assert.equal(
    location?.route.search,
    "?boardId=board%2Fother&issueId=issue-7",
  );
  assert.deepEqual(location?.viewport, {
    kind: "element",
    key: "board-issue-sheet",
    xRatio: 0,
    yRatio: 0.5,
  });
});

test("Board restore target은 권한 있는 다른 board의 issue sheet를 허용한다", () => {
  const location = createBoardWorkspaceLocation(
    {
      boardId: "board-2",
      issueId: "issue-9",
      surface: "board-issue-sheet",
    },
    metrics,
  );

  assert.deepEqual(
    readBoardWorkspaceTarget(location, ["board-1", "board-2"]),
    {
      boardId: "board-2",
      issueId: "issue-9",
      surface: "board-issue-sheet",
      viewport: location?.viewport,
    },
  );
  assert.equal(readBoardWorkspaceTarget(location, ["board-1"]), null);
});

test("Board restore target은 surface와 issue 조합이 잘못되면 거부한다", () => {
  const base = createBoardWorkspaceLocation(
    { boardId: "board-1", issueId: null, surface: "board-kanban" },
    metrics,
  );
  assert.ok(base);

  assert.equal(
    readBoardWorkspaceTarget(
      {
        ...base,
        context: { boardId: "board-1", issueId: "draft-issue" },
      },
      ["board-1"],
    ),
    null,
  );
  assert.equal(
    readBoardWorkspaceTarget(
      {
        ...base,
        context: { boardId: "board-1", issueId: null },
        viewport: { ...base.viewport, key: "board-issue-sheet" },
      },
      ["board-1"],
    ),
    null,
  );
});

test("Board scroll 복원은 비율을 안전 범위로 제한한다", () => {
  assert.deepEqual(
    getBoardScrollOffset(
      { xRatio: 2, yRatio: -1 },
      {
        clientHeight: 400,
        clientWidth: 600,
        scrollHeight: 1_200,
        scrollWidth: 1_800,
      },
    ),
    { left: 1_200, top: 0 },
  );
});

test("Board restore는 대상 surface가 mount될 때까지 기다리고 abort를 존중한다", async () => {
  let target = null;
  const controller = new AbortController();
  const pending = waitForBoardScrollTarget({
    boardId: "board-2",
    findTarget: () => target,
    intervalMs: 1,
    issueId: "issue-9",
    signal: controller.signal,
    surface: "board-issue-sheet",
    timeoutMs: 100,
  });
  target = {
    boardId: "board-2",
    element: { id: "sheet" },
    issueId: "issue-9",
    surface: "board-issue-sheet",
  };
  assert.deepEqual(await pending, { id: "sheet" });

  const abortedController = new AbortController();
  const aborted = waitForBoardScrollTarget({
    boardId: "board-2",
    findTarget: () => null,
    intervalMs: 1,
    issueId: null,
    signal: abortedController.signal,
    surface: "board-kanban",
    timeoutMs: 100,
  });
  abortedController.abort();
  assert.equal(await aborted, null);
});

test("Board adapter는 공통 수동 취소를 재사용하고 읽기 전용 marker만 연결한다", async () => {
  const adapter = await readFile(
    new URL("./board-workspace-location-adapter.tsx", import.meta.url),
    "utf8",
  );
  const panel = await readFile(
    new URL("./components/board-panel.tsx", import.meta.url),
    "utf8",
  );
  const sheet = await readFile(
    new URL("./components/board-issue-sheet.tsx", import.meta.url),
    "utf8",
  );

  assert.match(adapter, /waitForBoardScrollTarget/);
  assert.match(adapter, /signal/);
  assert.doesNotMatch(adapter, /reportManualInteraction|stopFollowing/);
  assert.match(panel, /onSelectBoard/);
  assert.match(panel, /data-workspace-follow-board-id/);
  assert.match(sheet, /data-workspace-follow-surface/);
  assert.match(sheet, /!isEditing/);
});
