"use client";

import {
  createShapeId,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLBindingCreate,
  type TLCreateShapePartial,
  type TLShapeId,
} from "tldraw";
import type {
  CanvasAgentHtmlArtifact,
  CanvasAgentSelectedScene,
} from "../api/canvas-agent-types";
import {
  createImportedCodeBlockShape,
  PILO_IMPORTED_CODE_BLOCK_HEIGHT,
  PILO_IMPORTED_CODE_BLOCK_WIDTH,
} from "../engine/shapes/pilo-canvas-shape-factory";
import {
  buildCanvasAgentHtmlInsertionPlan,
  buildHtmlFileName,
  type CanvasAgentHtmlInsertionBounds,
} from "./canvas-agent-html-insertion-plan";

const CODE_BLOCK_GAP = 120;
const RUN_ID_META_KEY = "piloCanvasAgentRunId";

export type CanvasAgentHtmlInsertionResult = {
  codeBlockId: TLShapeId;
  connectorId: TLShapeId;
};

export function insertCanvasAgentHtmlArtifact(
  editor: Editor,
  runId: string,
  artifact: CanvasAgentHtmlArtifact,
  selectedScene: CanvasAgentSelectedScene,
): CanvasAgentHtmlInsertionResult | null {
  const existingCodeBlock = editor.getCurrentPageShapes().find(
    (shape) =>
      shape.type === "pilo-code-block" &&
      shape.meta?.[RUN_ID_META_KEY] === runId,
  );
  if (existingCodeBlock) {
    const existingConnector = editor.getCurrentPageShapes().find(
      (shape) =>
        shape.type === "arrow" &&
        shape.meta?.[RUN_ID_META_KEY] === runId,
    );
    if (!existingConnector) return null;

    return {
      codeBlockId: existingCodeBlock.id,
      connectorId: existingConnector.id,
    };
  }

  const sourceBounds = collectBounds(
    artifact.sourceShapeIds.flatMap((shapeId) => {
      const bounds = editor.getShapePageBounds(shapeId as TLShapeId);
      return bounds
        ? [{ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }]
        : [];
    }),
  );
  if (!sourceBounds) return null;

  const targetShape = resolveConnectorTarget(editor, selectedScene, artifact);
  if (!targetShape) return null;
  const targetBounds = editor.getShapePageBounds(targetShape.id);
  if (!targetBounds) return null;

  const insertionPlan = buildCanvasAgentHtmlInsertionPlan(
    sourceBounds,
    targetBounds,
    {
      width: PILO_IMPORTED_CODE_BLOCK_WIDTH,
      height: PILO_IMPORTED_CODE_BLOCK_HEIGHT,
    },
    CODE_BLOCK_GAP,
  );
  const { codeBlockPosition, connectorEnd, connectorStart } = insertionPlan;
  const codeBlock = createImportedCodeBlockShape(
    0,
    codeBlockPosition,
    {
      code: artifact.html,
      fileName: buildHtmlFileName(artifact.title),
      language: "html",
    },
  );
  codeBlock.meta = {
    ...codeBlock.meta,
    [RUN_ID_META_KEY]: runId,
  };

  const connectorId = createShapeId(`pilo-canvas-agent-html-${runId}`);
  const connector: TLCreateShapePartial<TLArrowShape> & { id: TLShapeId } = {
    id: connectorId,
    type: "arrow",
    x: connectorStart.x,
    y: connectorStart.y,
    meta: {
      [RUN_ID_META_KEY]: runId,
    },
    props: {
      kind: "arc",
      color: "grey",
      dash: "solid",
      arrowheadStart: "none",
      arrowheadEnd: "none",
      start: { x: 0, y: 0 },
      end: {
        x: connectorEnd.x - connectorStart.x,
        y: connectorEnd.y - connectorStart.y,
      },
      bend: 0,
    },
  };
  const bindings: TLBindingCreate<TLArrowBinding>[] = [
    {
      type: "arrow",
      fromId: connectorId,
      toId: targetShape.id,
      props: {
        terminal: "start",
        normalizedAnchor: { x: 1, y: 0.5 },
        isExact: false,
        isPrecise: true,
        snap: "none",
      },
    },
    {
      type: "arrow",
      fromId: connectorId,
      toId: codeBlock.id,
      props: {
        terminal: "end",
        normalizedAnchor: { x: 0, y: 0.5 },
        isExact: false,
        isPrecise: true,
        snap: "none",
      },
    },
  ];

  editor.run(() => {
    editor.createShapes([codeBlock, connector]);
    editor.createBindings(bindings);
    editor.select(codeBlock.id);
  });

  return {
    codeBlockId: codeBlock.id,
    connectorId,
  };
}

function resolveConnectorTarget(
  editor: Editor,
  selectedScene: CanvasAgentSelectedScene,
  artifact: CanvasAgentHtmlArtifact,
) {
  const rootShapes = selectedScene.rootShapeIds.flatMap((shapeId) => {
    const shape = editor.getShape(shapeId as TLShapeId);
    return shape ? [shape] : [];
  });

  return (
    rootShapes.find((shape) => shape.type === "frame") ??
    rootShapes[0] ??
    artifact.sourceShapeIds.flatMap((shapeId) => {
      const shape = editor.getShape(shapeId as TLShapeId);
      return shape ? [shape] : [];
    })[0] ??
    null
  );
}

function collectBounds(
  bounds: CanvasAgentHtmlInsertionBounds[],
): CanvasAgentHtmlInsertionBounds | null {
  if (!bounds.length) return null;

  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.w));
  const bottom = Math.max(...bounds.map((item) => item.y + item.h));

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}
