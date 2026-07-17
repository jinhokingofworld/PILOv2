import { badRequest } from "../../../common/api-error";
import type {
  CanvasAgentConversationContext,
  CanvasAgentConversationMessage,
  CanvasAgentLastTaskContext,
  CanvasAgentPresentationMode,
  CanvasAgentRequestContext,
  CanvasAgentSelectedScene,
  CanvasAgentSelectedSceneShape,
  CanvasAgentShapeSummary,
  CanvasAgentViewport,
  CreateCanvasAgentRunRequest
} from "./canvas-agent.types";

const MAX_CONVERSATION_MESSAGES = 10;
const MAX_CONVERSATION_MESSAGE_BYTES = 2_000;
const MAX_LAST_TASK_PROMPT_BYTES = 4_000;
const MAX_LAST_TASK_SUMMARY_BYTES = 2_000;
const MAX_SELECTED_SHAPES = 160;
const MAX_SHAPE_SUMMARIES = 120;
const MAX_SELECTED_SCENE_SHAPES = 160;
const MAX_SELECTED_SCENE_DEPTH = 12;
const MAX_SELECTED_SCENE_BYTES = 50_000;
const MAX_SHAPE_SUMMARY_TEXT_BYTES = 1_000;
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
      conversationContext: validateConversationContext(input.conversationContext),
      presentationMode: validatePresentationMode(input.presentationMode),
      selectedShapeIds: validateSelectedShapeIds(input.selectedShapeIds),
      selectedScene: validateSelectedScene(input.selectedScene),
      selectedSceneError: readBoundedOptionalString(
        input.selectedSceneError,
        "Canvas Agent selectedSceneError",
        500
      ),
      shapeSummaries: validateShapeSummaries(input.shapeSummaries),
      toolHelpMode: input.toolHelpMode === true,
      viewport: validateViewport(input.viewport)
    }
  };
}

function validateSelectedScene(value: unknown): CanvasAgentSelectedScene | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw badRequest("Canvas Agent selectedScene is invalid");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SELECTED_SCENE_BYTES) {
    throw badRequest(`Canvas Agent selectedScene must be ${MAX_SELECTED_SCENE_BYTES} bytes or less`);
  }
  if (value.selectionMode !== "frame" && value.selectionMode !== "multi-selection") {
    throw badRequest("Canvas Agent selectedScene selectionMode is invalid");
  }
  if (!isRecord(value.bounds)) throw badRequest("Canvas Agent selectedScene bounds is invalid");
  const width = readPositiveFiniteNumber(value.bounds.width, "Canvas Agent selectedScene bounds width");
  const height = readPositiveFiniteNumber(value.bounds.height, "Canvas Agent selectedScene bounds height");
  if (!Array.isArray(value.shapes) || value.shapes.length === 0 || value.shapes.length > MAX_SELECTED_SCENE_SHAPES) {
    throw badRequest(`Canvas Agent selectedScene shapes must contain 1 to ${MAX_SELECTED_SCENE_SHAPES} items`);
  }
  const shapes = value.shapes.map(validateSelectedSceneShape);
  const ids = new Set(shapes.map((shape) => shape.id));
  if (ids.size !== shapes.length) throw badRequest("Canvas Agent selectedScene shape ids must be unique");
  shapes.forEach((shape) => {
    if (shape.parentId && !ids.has(shape.parentId)) {
      throw badRequest("Canvas Agent selectedScene parentId must reference an included shape");
    }
  });
  const parentById = new Map(shapes.map((shape) => [shape.id, shape.parentId]));
  shapes.forEach((shape) => {
    const visited = new Set<string>();
    let parentId = shape.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        throw badRequest("Canvas Agent selectedScene parent relationship must not contain a cycle");
      }
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  });
  const rootShapeIds = validateSceneShapeIds(value.rootShapeIds, "Canvas Agent selectedScene rootShapeIds");
  if (!rootShapeIds.length || rootShapeIds.some((id) => !ids.has(id))) {
    throw badRequest("Canvas Agent selectedScene rootShapeIds must reference included shapes");
  }
  if (!isRecord(value.options)
    || value.options.styleMode !== "faithful"
    || value.options.responsive !== false
    || value.options.includeJavaScript !== false) {
    throw badRequest("Canvas Agent selectedScene options are invalid");
  }

  return {
    selectionMode: value.selectionMode,
    bounds: { width, height },
    rootShapeIds,
    shapes,
    options: { styleMode: "faithful", responsive: false, includeJavaScript: false }
  };
}

function validateSelectedSceneShape(value: unknown): CanvasAgentSelectedSceneShape {
  if (!isRecord(value)) throw badRequest("Canvas Agent selectedScene shape is invalid");
  const id = readBoundedOptionalString(value.id, "Canvas Agent selectedScene shape id", 200);
  const shapeType = readBoundedOptionalString(value.shapeType, "Canvas Agent selectedScene shapeType", 100);
  if (!id || !shapeType) throw badRequest("Canvas Agent selectedScene shape id and shapeType are required");
  const depth = readFiniteNumber(value.depth, "Canvas Agent selectedScene shape depth");
  const zIndex = readFiniteNumber(value.zIndex, "Canvas Agent selectedScene shape zIndex");
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_SELECTED_SCENE_DEPTH) {
    throw badRequest(`Canvas Agent selectedScene shape depth must be between 0 and ${MAX_SELECTED_SCENE_DEPTH}`);
  }
  if (!Number.isInteger(zIndex) || zIndex < 0 || zIndex >= MAX_SELECTED_SCENE_SHAPES) {
    throw badRequest("Canvas Agent selectedScene shape zIndex is invalid");
  }

  return {
    id,
    shapeType,
    parentId: readBoundedOptionalString(value.parentId, "Canvas Agent selectedScene shape parentId", 200),
    x: readFiniteNumber(value.x, "Canvas Agent selectedScene shape x"),
    y: readFiniteNumber(value.y, "Canvas Agent selectedScene shape y"),
    width: readPositiveFiniteNumber(value.width, "Canvas Agent selectedScene shape width"),
    height: readPositiveFiniteNumber(value.height, "Canvas Agent selectedScene shape height"),
    rotation: readFiniteNumber(value.rotation, "Canvas Agent selectedScene shape rotation"),
    zIndex,
    depth,
    title: readBoundedOptionalString(value.title, "Canvas Agent selectedScene shape title", 4_000),
    text: readBoundedOptionalString(value.text, "Canvas Agent selectedScene shape text", 8_000),
    assetRef: readBoundedOptionalString(value.assetRef, "Canvas Agent selectedScene shape assetRef", 200),
    style: validateSelectedSceneStyle(value.style)
  };
}

function validateSelectedSceneStyle(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length > 24) {
    throw badRequest("Canvas Agent selectedScene shape style is invalid");
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) {
      throw badRequest("Canvas Agent selectedScene shape style key is invalid");
    }
    if (item === null || typeof item === "boolean") return [key, item];
    if (typeof item === "number" && Number.isFinite(item)) return [key, item];
    if (typeof item === "string" && Buffer.byteLength(item, "utf8") <= 200) return [key, item];
    throw badRequest("Canvas Agent selectedScene shape style value is invalid");
  }));
}

function validateSceneShapeIds(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_SELECTED_SCENE_SHAPES) {
    throw badRequest(`${fieldName} is invalid`);
  }
  const ids = value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 200) {
      throw badRequest(`${fieldName} is invalid`);
    }
    return item.trim();
  });
  return Array.from(new Set(ids));
}

function validateShapeSummaries(value: unknown): CanvasAgentShapeSummary[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SHAPE_SUMMARIES) {
    throw badRequest(`Canvas Agent shapeSummaries must contain ${MAX_SHAPE_SUMMARIES} items or fewer`);
  }

  const summaries = value.map((item) => {
    if (!isRecord(item)) throw badRequest("Canvas Agent shapeSummaries item is invalid");
    const id = readBoundedOptionalString(item.id, "Canvas Agent shapeSummaries id", 200);
    const shapeType = readBoundedOptionalString(
      item.shapeType,
      "Canvas Agent shapeSummaries shapeType",
      100
    );
    if (!id || !shapeType) {
      throw badRequest("Canvas Agent shapeSummaries id and shapeType are required");
    }

    const width = readFiniteNumber(item.width, "Canvas Agent shapeSummaries width");
    const height = readFiniteNumber(item.height, "Canvas Agent shapeSummaries height");
    if (width <= 0 || height <= 0) {
      throw badRequest("Canvas Agent shapeSummaries width and height must be greater than 0");
    }

    return {
      id,
      shapeType,
      title: readBoundedOptionalString(
        item.title,
        "Canvas Agent shapeSummaries title",
        MAX_SHAPE_SUMMARY_TEXT_BYTES
      ),
      text: readBoundedOptionalString(
        item.text,
        "Canvas Agent shapeSummaries text",
        MAX_SHAPE_SUMMARY_TEXT_BYTES
      ),
      x: readFiniteNumber(item.x, "Canvas Agent shapeSummaries x"),
      y: readFiniteNumber(item.y, "Canvas Agent shapeSummaries y"),
      width,
      height
    };
  });

  const ids = new Set<string>();
  return summaries.filter((summary) => {
    if (ids.has(summary.id)) return false;
    ids.add(summary.id);
    return true;
  });
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

function validateConversationContext(value: unknown): CanvasAgentConversationContext | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw badRequest("Canvas Agent conversationContext is invalid");

  const messages = validateConversationMessages(value.messages);
  const lastTask = validateLastTaskContext(value.lastTask);
  if (!messages.length && lastTask === null) return null;
  return { messages, lastTask };
}

function validateConversationMessages(value: unknown): CanvasAgentConversationMessage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("Canvas Agent conversationContext.messages is invalid");
  if (value.length > MAX_CONVERSATION_MESSAGES) {
    throw badRequest(`Canvas Agent conversationContext.messages must contain ${MAX_CONVERSATION_MESSAGES} items or fewer`);
  }

  return value.map((item) => {
    if (!isRecord(item)) throw badRequest("Canvas Agent conversationContext.messages item is invalid");
    const role = item.role;
    if (role !== "assistant" && role !== "user") {
      throw badRequest("Canvas Agent conversationContext.messages role is invalid");
    }
    const content = readBoundedOptionalString(
      item.content,
      "Canvas Agent conversationContext.messages content",
      MAX_CONVERSATION_MESSAGE_BYTES
    );
    if (content === null) {
      throw badRequest("Canvas Agent conversationContext.messages content is required");
    }
    return { role, content };
  });
}

function validateLastTaskContext(value: unknown): CanvasAgentLastTaskContext | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw badRequest("Canvas Agent conversationContext.lastTask is invalid");

  const prompt = readBoundedOptionalString(
    value.prompt,
    "Canvas Agent conversationContext.lastTask.prompt",
    MAX_LAST_TASK_PROMPT_BYTES
  );
  if (prompt === null) {
    throw badRequest("Canvas Agent conversationContext.lastTask.prompt is required");
  }

  return {
    draftId: readBoundedOptionalString(value.draftId, "Canvas Agent conversationContext.lastTask.draftId", 200),
    draftTitle: readBoundedOptionalString(value.draftTitle, "Canvas Agent conversationContext.lastTask.draftTitle", 300),
    prompt,
    status: readBoundedOptionalString(value.status, "Canvas Agent conversationContext.lastTask.status", 80) ?? "unknown",
    summary: readBoundedOptionalString(
      value.summary,
      "Canvas Agent conversationContext.lastTask.summary",
      MAX_LAST_TASK_SUMMARY_BYTES
    )
  };
}

function readBoundedOptionalString(value: unknown, fieldName: string, maxBytes: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw badRequest(`${fieldName} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
    throw badRequest(`${fieldName} must be ${maxBytes} bytes or less`);
  }
  return normalized;
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

function readPositiveFiniteNumber(value: unknown, fieldName: string): number {
  const result = readFiniteNumber(value, fieldName);
  if (result <= 0) throw badRequest(`${fieldName} must be greater than 0`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
