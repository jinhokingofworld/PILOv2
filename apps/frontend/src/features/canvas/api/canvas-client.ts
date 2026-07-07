import { createCanvasApiClient } from "./canvas-api-client";
import { createMockCanvasClient } from "./canvas-mock-client";
import type { CanvasClientMode, CanvasClientOptions } from "./canvas-types";

export { CanvasApiError, buildCanvasApiUrl, createCanvasApiClient } from "./canvas-api-client";
export { createMockCanvasClient } from "./canvas-mock-client";
export {
  createMockCanvasBoardDetail,
  normalizeCanvasBoardDetail,
  unwrapCanvasApiData,
} from "./canvas-normalizers";
export type {
  CanvasBoardDetail,
  CanvasBoardSummary,
  CanvasClientMode,
  CanvasClientOptions,
  CanvasViewSetting,
  CanvasViewportShapeQuery,
  CanvasWorkspaceRequestOptions,
} from "./canvas-types";

const DEFAULT_CANVAS_MODE = "api";

function defaultCanvasMode() {
  return process.env.NEXT_PUBLIC_PILO_CANVAS_MODE ?? DEFAULT_CANVAS_MODE;
}

export function resolveCanvasClientMode(
  mode = defaultCanvasMode(),
): CanvasClientMode {
  return mode === "api" ? "api" : "mock";
}

export function createCanvasClient(options: CanvasClientOptions = {}) {
  const mode = resolveCanvasClientMode(options.mode);

  if (mode === "api") {
    return createCanvasApiClient(options);
  }

  return createMockCanvasClient();
}
