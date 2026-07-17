import type {
  ActivityLogActorType,
  ActivityLogInput
} from "../../../common/activity-log.service";
import type {
  CanvasShapeOperationPayload,
  CanvasShapePayload
} from "../contracts/canvas.types";

export type CanvasActivityActorType = Extract<
  ActivityLogActorType,
  "user" | "agent"
>;

interface BuildCanvasShapeActivityLogInput {
  actorType: CanvasActivityActorType;
  after?: CanvasShapePayload;
  before?: CanvasShapePayload;
  operation: CanvasShapeOperationPayload;
}

const TRACKED_CANVAS_SHAPE_TYPES = new Set([
  "sticky-note",
  "note",
  "text",
  "frame",
  "pilo-code-block",
  "arrow",
  "line"
]);
const PILO_CODE_LANGUAGES = new Set([
  "tsx",
  "ts",
  "jsx",
  "js",
  "json",
  "css",
  "html",
  "md",
  "sql",
  "py",
  "c"
]);
const TEXT_PREVIEW_MAX_LENGTH = 160;
const SENSITIVE_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+\S+/i,
  /\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}\b/i,
  /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\s*[:=]\s*\S+/i
];

export function buildCanvasShapeActivityLog(
  input: BuildCanvasShapeActivityLogInput
): ActivityLogInput | null {
  const { operation } = input;

  if (operation.operationType === "create") {
    if (!input.after || !isTrackedShapeType(input.after.shapeType)) {
      return null;
    }

    return buildActivityLog(input.actorType, operation, input.after, {
      summary: `${shapeLabel(input.after.shapeType)}을(를) 생성했습니다.`,
      data: buildShapeMetadata(input.after, true)
    });
  }

  if (operation.operationType === "delete") {
    if (!input.before || !isTrackedShapeType(input.before.shapeType)) {
      return null;
    }

    return buildActivityLog(input.actorType, operation, input.before, {
      summary: `${shapeLabel(input.before.shapeType)}을(를) 삭제했습니다.`,
      data: buildShapeMetadata(input.before, false)
    });
  }

  if (!input.before || !input.after) {
    return null;
  }

  if (
    !isTrackedShapeType(input.before.shapeType) &&
    !isTrackedShapeType(input.after.shapeType)
  ) {
    return null;
  }

  const changedFields = semanticChangedFields(input.before, input.after);
  if (changedFields.length === 0) {
    return null;
  }

  return buildActivityLog(input.actorType, operation, input.after, {
    summary: `${shapeLabel(input.after.shapeType)}의 내용을 수정했습니다.`,
    data: {
      ...buildShapeMetadata(input.after, changedFields.includes("text")),
      changedFields
    }
  });
}

function buildActivityLog(
  actorType: CanvasActivityActorType,
  operation: CanvasShapeOperationPayload,
  shape: CanvasShapePayload,
  metadata: Omit<ActivityLogInput["metadata"], "version">
): ActivityLogInput {
  const action = `canvas_shape_${operation.operationType}d` as const;

  return {
    workspaceId: operation.workspaceId,
    actor: {
      type: actorType,
      userId: operation.actorUserId
    },
    action,
    target: {
      type: "canvas_shape",
      id: shape.id
    },
    dedupeKey: `canvas:${action}:${shape.id}:${operation.id}`,
    metadata: {
      version: 1,
      ...metadata
    }
  };
}

function buildShapeMetadata(
  shape: CanvasShapePayload,
  includeTextPreview: boolean
): Record<string, unknown> {
  const title = safeText(shape.title);
  const textPreview =
    includeTextPreview && shape.shapeType !== "pilo-code-block"
      ? safeText(shape.textContent)
      : null;
  const language = readCodeLanguage(shape);

  return {
    canvasId: shape.canvasId,
    shapeType: shape.shapeType,
    ...(title ? { title } : {}),
    ...(textPreview ? { textPreview } : {}),
    ...(language ? { language } : {})
  };
}

function semanticChangedFields(
  before: CanvasShapePayload,
  after: CanvasShapePayload
): string[] {
  const changedFields: string[] = [];

  if (before.title !== after.title) {
    changedFields.push(after.shapeType === "frame" ? "name" : "title");
  }

  if (before.textContent !== after.textContent) {
    changedFields.push(
      after.shapeType === "pilo-code-block" ? "code" : "text"
    );
  }

  if (readCodeLanguage(before) !== readCodeLanguage(after)) {
    changedFields.push("language");
  }

  return changedFields;
}

function readCodeLanguage(shape: CanvasShapePayload): string | null {
  if (shape.shapeType !== "pilo-code-block") {
    return null;
  }

  const props = isRecord(shape.rawShape.props) ? shape.rawShape.props : null;
  const language = props?.language;
  return typeof language === "string" && PILO_CODE_LANGUAGES.has(language)
    ? language
    : null;
}

function safeText(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (SENSITIVE_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  return normalized.slice(0, TEXT_PREVIEW_MAX_LENGTH);
}

function isTrackedShapeType(shapeType: string): boolean {
  return TRACKED_CANVAS_SHAPE_TYPES.has(shapeType);
}

function shapeLabel(shapeType: string): string {
  switch (shapeType) {
    case "sticky-note":
    case "note":
      return "Canvas 노트";
    case "text":
      return "Canvas 텍스트";
    case "frame":
      return "Canvas 프레임";
    case "pilo-code-block":
      return "Canvas 코드 블록";
    case "arrow":
      return "Canvas 화살표";
    case "line":
      return "Canvas 선";
    default:
      return "Canvas 도형";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
