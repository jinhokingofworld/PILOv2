export type CanvasAgentHtmlInsertionBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function buildCanvasAgentHtmlInsertionPlan(
  sourceBounds: CanvasAgentHtmlInsertionBounds,
  targetBounds: CanvasAgentHtmlInsertionBounds,
  codeBlockSize: { width: number; height: number },
  gap = 120,
) {
  const codeBlockPosition = {
    x: sourceBounds.x + sourceBounds.w + gap,
    y: sourceBounds.y + (sourceBounds.h - codeBlockSize.height) / 2,
  };

  return {
    codeBlockPosition,
    connectorStart: {
      x: targetBounds.x + targetBounds.w,
      y: targetBounds.y + targetBounds.h / 2,
    },
    connectorEnd: {
      x: codeBlockPosition.x,
      y: codeBlockPosition.y + codeBlockSize.height / 2,
    },
  };
}

export function buildHtmlFileName(title: string) {
  const normalized = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 100)
    .trim();
  const baseName = normalized || "canvas-page";

  return baseName.toLowerCase().endsWith(".html")
    ? baseName
    : `${baseName}.html`;
}
