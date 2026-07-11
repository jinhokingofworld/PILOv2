import { badRequest } from "../../../common/api-error";
import type {
  CanvasAgentPresentationMode,
  CanvasAgentRequestContext,
  CanvasAgentViewport,
  CreateCanvasAgentRunRequest
} from "./canvas-agent.types";

const MAX_SELECTED_SHAPES = 40;
const MAX_CLIENT_REQUEST_ID_BYTES = 128;

export function validateCanvasAgentRunRequest(
  input: CreateCanvasAgentRunRequest
): { clientRequestId: string | null; context: CanvasAgentRequestContext; prompt: string; toolHelpMode: boolean } {
  if (!isRecord(input)) {
    throw badRequest("Canvas Agent request body is required");
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || Buffer.byteLength(prompt, "utf8") > 32768) {
    throw badRequest("Canvas Agent prompt must be between 1 and 32768 bytes");
  }

  return {
    prompt,
    clientRequestId: validateClientRequestId(input.clientRequestId),
    toolHelpMode: input.toolHelpMode === true,
    context: {
      presentationMode: validatePresentationMode(input.presentationMode),
      selectedShapeIds: validateSelectedShapeIds(input.selectedShapeIds),
      toolHelpMode: input.toolHelpMode === true,
      viewport: validateViewport(input.viewport)
    }
  };
}

export function validateApplyClientOperationId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("Canvas Agent draft clientOperationId is required");
  }

  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") > 128) {
    throw badRequest("Canvas Agent draft clientOperationId must be 128 bytes or less");
  }

  return normalized;
}

function validateClientRequestId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("Canvas Agent clientRequestId must be a non-empty string");
  }

  const normalized = value.trim();
  if (Buffer.byteLength(normalized, "utf8") > MAX_CLIENT_REQUEST_ID_BYTES) {
    throw badRequest("Canvas Agent clientRequestId must be 128 bytes or less");
  }

  return normalized;
}

function validateSelectedShapeIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SELECTED_SHAPES) {
    throw badRequest(`Canvas Agent selectedShapeIds must contain ${MAX_SELECTED_SHAPES} ids or fewer`);
  }

  const ids = value.map((id) => {
    if (typeof id !== "string" || !id.trim() || id.trim().length > 200) {
      throw badRequest("Canvas Agent selectedShapeIds is invalid");
    }
    return id.trim();
  });

  return Array.from(new Set(ids));
}

function validatePresentationMode(value: unknown): CanvasAgentPresentationMode {
  if (value === undefined || value === null || value === "") return "interactive";
  if (value === "interactive" || value === "background") return value;
  throw badRequest("Canvas Agent presentationMode must be either interactive or background");
}

function validateViewport(value: unknown): CanvasAgentViewport | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw badRequest("Canvas Agent viewport is invalid");

  const x = readFiniteNumber(value.x, "Canvas Agent viewport x");
  const y = readFiniteNumber(value.y, "Canvas Agent viewport y");
  const width = readFiniteNumber(value.width, "Canvas Agent viewport width");
  const height = readFiniteNumber(value.height, "Canvas Agent viewport height");
  if (width <= 0 || height <= 0) {
    throw badRequest("Canvas Agent viewport width and height must be greater than 0");
  }

  return { x, y, width, height };
}

function readFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${fieldName} must be a finite number`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
