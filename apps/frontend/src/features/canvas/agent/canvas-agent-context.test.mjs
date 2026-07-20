import assert from "node:assert/strict";
import {
  buildCanvasAgentShapeSummaries,
  MAX_CANVAS_AGENT_SHAPE_SUMMARIES,
} from "./canvas-agent-shape-context.ts";
import {
  focusCanvasAgentResult,
  getCanvasAgentReadyShapeIds,
} from "./canvas-agent-camera.ts";
import {
  buildCanvasAgentDeepLink,
  getCanvasAgentDriveShapeId,
  readCanvasAgentDeepLinkRunId,
} from "./canvas-agent-deep-link.ts";
import {
  buildCanvasAgentHtmlInsertionPlan,
  buildHtmlFileName,
} from "./canvas-agent-html-insertion-plan.ts";
import { completeCanvasAgentFocusProgress } from "./canvas-agent-progress.ts";
import {
  buildCanvasAgentSelectedScene,
  CanvasAgentSelectedSceneError,
} from "./canvas-agent-selected-scene.ts";

function shape(id, x, text) {
  return {
    id,
    type: "sticky-note",
    props: { richText: { content: [{ text }] } },
    x,
    y: 20,
  };
}

{
  const completedProgress = completeCanvasAgentFocusProgress(
    {
      highlightedShapeIds: ["shape:dashboard"],
      loadRootShapeIds: ["shape:root"],
      message: "검색 결과를 불러오고 있습니다.",
      targetViewport: { x: 20_000, y: 20_000, width: 640, height: 360 },
      toolTarget: null,
      toolTargetLabel: null,
    },
    "검색 결과로 이동했습니다.",
  );

  assert.equal(completedProgress.message, "검색 결과로 이동했습니다.");
  assert.deepEqual(completedProgress.highlightedShapeIds, []);
  assert.deepEqual(completedProgress.loadRootShapeIds, []);
  assert.equal(completedProgress.targetViewport, null);
}

{
  const canvasId = "44444444-4444-4444-8444-444444444444";
  const runId = "55555555-5555-4555-8555-555555555555";
  const href = buildCanvasAgentDeepLink(canvasId, runId);
  assert.equal(
    href,
    `/canvas?canvasId=${canvasId}&canvasAgentRunId=${runId}`,
  );
  assert.equal(
    readCanvasAgentDeepLinkRunId(new URL(href, "https://pilo.local").searchParams, canvasId),
    runId,
  );
  assert.equal(
    readCanvasAgentDeepLinkRunId(new URLSearchParams(`canvasId=${canvasId}`), canvasId),
    null,
  );
  assert.equal(
    readCanvasAgentDeepLinkRunId(
      new URLSearchParams(`canvasId=${canvasId}&canvasAgentRunId=${runId}`),
      "66666666-6666-4666-8666-666666666666",
    ),
    null,
  );
  assert.equal(
    getCanvasAgentDriveShapeId(runId),
    `shape:pilo-canvas-agent-drive-${runId}`,
  );
}

{
  const plan = buildCanvasAgentHtmlInsertionPlan(
    { x: 100, y: 200, w: 1000, h: 800 },
    { x: 100, y: 200, w: 1000, h: 800 },
    { width: 460, height: 300 },
  );

  assert.deepEqual(plan.codeBlockPosition, { x: 1220, y: 450 });
  assert.deepEqual(plan.connectorStart, { x: 1100, y: 600 });
  assert.deepEqual(plan.connectorEnd, { x: 1220, y: 600 });
  assert.equal(buildHtmlFileName("대시보드: 와이어프레임"), "대시보드- 와이어프레임.html");
  assert.equal(buildHtmlFileName("dashboard.HTML"), "dashboard.HTML");
  assert.equal(buildHtmlFileName("  "), "canvas-page.html");
}

{
  const shapes = [
    {
      id: "shape:page",
      type: "frame",
      parentId: "page:page",
      rotation: 0,
      meta: { piloChildShapeCount: 2 },
      props: { name: "대시보드", color: "white" },
    },
    {
      id: "shape:section",
      type: "frame",
      parentId: "shape:page",
      rotation: 0,
      props: { name: "요약", color: "grey" },
    },
    {
      id: "shape:title",
      type: "text",
      parentId: "shape:section",
      rotation: 0,
      props: { richText: { content: [{ text: "대시보드 요약" }] }, color: "black" },
    },
  ];
  const bounds = new Map([
    ["shape:page", { x: 100, y: 200, w: 1000, h: 800 }],
    ["shape:section", { x: 200, y: 300, w: 600, h: 300 }],
    ["shape:title", { x: 240, y: 340, w: 240, h: 48 }],
  ]);
  const editor = {
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => ["shape:page", "shape:title"],
    getShape: (id) => shapes.find((item) => item.id === id),
    getShapePageBounds: (id) => bounds.get(String(id)),
  };

  const scene = buildCanvasAgentSelectedScene(editor);

  assert.equal(scene.selectionMode, "frame");
  assert.deepEqual(scene.rootShapeIds, ["shape:page"]);
  assert.deepEqual(scene.bounds, { width: 1000, height: 800 });
  assert.equal(scene.shapes.length, 3);
  assert.equal(scene.shapes.find((item) => item.id === "shape:section").x, 100);
  assert.equal(scene.shapes.find((item) => item.id === "shape:title").depth, 2);
  assert.equal(scene.shapes.find((item) => item.id === "shape:title").text, "대시보드 요약");
}

{
  const shapes = [
    { id: "shape:left", type: "geo", parentId: "page:page", rotation: 0, props: {} },
    { id: "shape:right", type: "geo", parentId: "page:page", rotation: 0, props: {} },
  ];
  const editor = {
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => ["shape:right", "shape:left"],
    getShape: (id) => shapes.find((item) => item.id === id),
    getShapePageBounds: (id) => String(id) === "shape:left"
      ? { x: 100, y: 100, w: 200, h: 100 }
      : { x: 500, y: 300, w: 100, h: 100 },
  };

  const scene = buildCanvasAgentSelectedScene(editor);

  assert.equal(scene.selectionMode, "multi-selection");
  assert.deepEqual(scene.bounds, { width: 500, height: 300 });
  assert.equal(scene.shapes.find((item) => item.id === "shape:left").x, 0);
  assert.equal(scene.shapes.find((item) => item.id === "shape:right").x, 400);
}

{
  const frame = {
    id: "shape:frame",
    type: "frame",
    parentId: "page:page",
    meta: { piloChildShapeCount: 2 },
    props: {},
  };
  const editor = {
    getCurrentPageShapes: () => [frame],
    getSelectedShapeIds: () => [frame.id],
    getShape: () => frame,
    getShapePageBounds: () => ({ x: 0, y: 0, w: 500, h: 500 }),
  };

  assert.throws(
    () => buildCanvasAgentSelectedScene(editor),
    (error) => error instanceof CanvasAgentSelectedSceneError
      && error.missingFrameIds.includes(frame.id),
  );
}

{
  const shapes = [
    { id: "shape:a", type: "frame", parentId: "shape:b", props: {} },
    { id: "shape:b", type: "frame", parentId: "shape:a", props: {} },
  ];
  const editor = {
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => shapes.map((item) => item.id),
    getShape: (id) => shapes.find((item) => item.id === id),
    getShapePageBounds: (id) => String(id) === "shape:a"
      ? { x: 0, y: 0, w: 100, h: 100 }
      : { x: 120, y: 0, w: 100, h: 100 },
  };

  assert.throws(
    () => buildCanvasAgentSelectedScene(editor),
    (error) => error instanceof CanvasAgentSelectedSceneError
      && error.message.includes("순환"),
  );
}

{
  const shapes = Array.from(
    { length: MAX_CANVAS_AGENT_SHAPE_SUMMARIES + 1 },
    (_, index) => shape(`shape:${index}`, index * 200, `메모 ${index}`),
  );
  const selectedId = shapes.at(-1).id;
  const editor = {
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => [selectedId],
    getShapePageBounds: (id) => {
      const index = Number(String(id).split(":")[1]);
      return { x: index * 200, y: 20, w: 180, h: 180 };
    },
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 800, h: 600 }),
  };

  const summaries = buildCanvasAgentShapeSummaries(editor);

  assert.equal(summaries.length, MAX_CANVAS_AGENT_SHAPE_SUMMARIES);
  assert.equal(summaries[0].id, selectedId);
  assert.equal(summaries[0].text, `메모 ${MAX_CANVAS_AGENT_SHAPE_SUMMARIES}`);
}

{
  const calls = [];
  const editor = {
    getShape: (id) => ({ id, parentId: "page:page" }),
    getShapePageBounds: (id) => id === "shape:a"
      ? { x: 100, y: 200, w: 180, h: 120 }
      : { x: 400, y: 500, w: 200, h: 160 },
    zoomToBounds: (bounds, options) => calls.push({ bounds, options }),
  };

  const usedLoadedBounds = focusCanvasAgentResult(
    editor,
    ["shape:a", "shape:b"],
    { x: 0, y: 0, width: 100, height: 100 },
  );

  assert.equal(usedLoadedBounds, true);
  assert.deepEqual(calls[0].bounds, { x: 100, y: 200, w: 500, h: 460 });
  assert.equal(calls[0].options.targetZoom, 1);
  assert.equal(calls[0].options.inset, 160);
}

{
  const shapes = new Map([
    ["shape:root", { id: "shape:root", parentId: "page:page" }],
    ["shape:child", { id: "shape:child", parentId: "shape:root" }],
    ["shape:orphan", { id: "shape:orphan", parentId: "shape:missing" }],
  ]);
  const editor = {
    getShape: (id) => shapes.get(String(id)),
  };

  assert.deepEqual(
    getCanvasAgentReadyShapeIds(editor, ["shape:child", "shape:orphan"]),
    ["shape:child"],
  );
  shapes.delete("shape:root");
  assert.deepEqual(getCanvasAgentReadyShapeIds(editor, ["shape:child"]), []);
}
