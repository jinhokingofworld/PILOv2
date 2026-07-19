const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CANVAS_AGENT_RUN_QUERY_KEY = "canvasAgentRunId";

export function buildCanvasAgentDeepLink(canvasId: string, runId: string) {
  return `/canvas?canvasId=${encodeURIComponent(canvasId)}&${CANVAS_AGENT_RUN_QUERY_KEY}=${encodeURIComponent(runId)}`;
}

export function readCanvasAgentDeepLinkRunId(
  searchParams: Pick<URLSearchParams, "get">,
  loadedCanvasId: string,
) {
  const requestedCanvasId = searchParams.get("canvasId")?.trim() ?? "";
  const runId = searchParams.get(CANVAS_AGENT_RUN_QUERY_KEY)?.trim() ?? "";

  if (
    requestedCanvasId !== loadedCanvasId ||
    !UUID_PATTERN.test(requestedCanvasId) ||
    !UUID_PATTERN.test(runId)
  ) {
    return null;
  }
  return runId;
}

export function getCanvasAgentDriveShapeId(runId: string) {
  if (!UUID_PATTERN.test(runId)) {
    throw new Error("Canvas Agent run id is invalid");
  }
  return `shape:pilo-canvas-agent-drive-${runId}`;
}
