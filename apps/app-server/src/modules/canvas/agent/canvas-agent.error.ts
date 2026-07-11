import { HttpException, HttpStatus } from "@nestjs/common";

type CanvasAgentErrorCode =
  | "CANVAS_AGENT_CLIENT_REQUEST_ID_CONFLICT"
  | "CANVAS_AGENT_DRAFT_NOT_PREVIEW"
  | "CANVAS_AGENT_DRAFT_STALE"
  | "SERVICE_UNAVAILABLE";

function canvasAgentError(
  status: HttpStatus,
  code: CanvasAgentErrorCode,
  message: string
): HttpException {
  return new HttpException({ success: false, error: { code, message } }, status);
}

export function canvasAgentClientRequestIdConflict(message: string): HttpException {
  return canvasAgentError(HttpStatus.CONFLICT, "CANVAS_AGENT_CLIENT_REQUEST_ID_CONFLICT", message);
}

export function canvasAgentDraftNotPreview(message: string): HttpException {
  return canvasAgentError(HttpStatus.CONFLICT, "CANVAS_AGENT_DRAFT_NOT_PREVIEW", message);
}

export function canvasAgentDraftStale(message: string): HttpException {
  return canvasAgentError(HttpStatus.CONFLICT, "CANVAS_AGENT_DRAFT_STALE", message);
}

export function canvasAgentJobUnavailable(message: string): HttpException {
  return canvasAgentError(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", message);
}
