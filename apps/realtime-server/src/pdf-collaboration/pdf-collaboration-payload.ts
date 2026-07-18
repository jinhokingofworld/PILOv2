import { normalizePdfCollaborationRoomRef } from "./pdf-collaboration-room";
import type {
  PdfCollaborationPageUpdate,
  PdfCollaborationPoint,
  PdfCollaborationPointerUpdate,
  PdfCollaborationRoomRef,
  PdfCollaborationStrokeCommit,
  PdfCollaborationStrokeRemove,
} from "./pdf-collaboration-types";

const MAX_PAGE_NUMBER = 100_000;
const MAX_STROKE_ID_LENGTH = 96;
const MAX_STROKE_POINTS = 500;
const PDF_STROKE_COLORS = new Set(["#111827", "#2563eb", "#dc2626", "#16a34a", "#facc15"]);
const PDF_STROKE_WIDTHS = new Set([0.7, 1.2, 1.8, 2.8, 4.2, 5.6]);

function defaultStrokeStyle(tool: "pen" | "highlighter") {
  return tool === "highlighter"
    ? { color: "#facc15", width: 2.8 }
    : { color: "#111827", width: 0.7 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function readPoint(value: unknown): PdfCollaborationPoint | null {
  if (!isRecord(value) || !isRatio(value.xRatio) || !isRatio(value.yRatio)) {
    return null;
  }

  return { xRatio: value.xRatio, yRatio: value.yRatio };
}

function readPageNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_NUMBER
    ? value
    : null;
}

function readRoomAndPage(payload: unknown): PdfCollaborationPageUpdate | null {
  const room = readPdfCollaborationRoomRef(payload);
  if (!room || !isRecord(payload)) return null;

  const pageNumber = readPageNumber(payload.pageNumber);
  return pageNumber ? { ...room, pageNumber } : null;
}

export function readPdfCollaborationRoomRef(
  payload: unknown,
): PdfCollaborationRoomRef | null {
  if (!isRecord(payload)) return null;

  const workspaceId = readRequiredString(payload, "workspaceId");
  const fileId = readRequiredString(payload, "fileId");
  if (!workspaceId || !fileId) return null;

  return normalizePdfCollaborationRoomRef({ fileId, workspaceId });
}

export function readPdfCollaborationPageUpdate(
  payload: unknown,
): PdfCollaborationPageUpdate | null {
  return readRoomAndPage(payload);
}

export function readPdfCollaborationPointerUpdate(
  payload: unknown,
): PdfCollaborationPointerUpdate | null {
  const update = readRoomAndPage(payload);
  if (!update || !isRecord(payload)) return null;

  const point = readPoint(payload);
  return point ? { ...update, ...point } : null;
}

export function readPdfCollaborationStrokeCommit(
  payload: unknown,
): PdfCollaborationStrokeCommit | null {
  const update = readRoomAndPage(payload);
  if (!update || !isRecord(payload)) return null;

  const id = readRequiredString(payload, "id");
  const tool = payload.tool;
  const pointValues = payload.points;
  if (
    !id ||
    id.length > MAX_STROKE_ID_LENGTH ||
    (tool !== "pen" && tool !== "highlighter") ||
    !Array.isArray(pointValues) ||
    pointValues.length === 0 ||
    pointValues.length > MAX_STROKE_POINTS
  ) {
    return null;
  }

  const defaults = defaultStrokeStyle(tool);
  const color = payload.color === undefined ? defaults.color : payload.color;
  const width = payload.width === undefined ? defaults.width : payload.width;
  if (
    typeof color !== "string" ||
    !PDF_STROKE_COLORS.has(color) ||
    typeof width !== "number" ||
    !PDF_STROKE_WIDTHS.has(width)
  ) {
    return null;
  }

  const points = pointValues.map(readPoint);
  return points.every((point): point is PdfCollaborationPoint => point !== null)
    ? { ...update, color, id, points, tool, width }
    : null;
}

export function readPdfCollaborationStrokeRemove(
  payload: unknown,
): PdfCollaborationStrokeRemove | null {
  const update = readRoomAndPage(payload);
  if (!update || !isRecord(payload)) return null;

  const strokeId = readRequiredString(payload, "strokeId");
  return strokeId && strokeId.length <= MAX_STROKE_ID_LENGTH
    ? { ...update, strokeId }
    : null;
}
