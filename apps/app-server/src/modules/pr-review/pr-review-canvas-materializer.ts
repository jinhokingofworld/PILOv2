import { createHash } from "node:crypto";
import {
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_RELATION_EDGE_SHAPE_TYPE
} from "../canvas/canvas-review-shape-policy";
import type {
  CanvasShapeRow,
  CompleteShapeWriteValues
} from "../canvas/canvas.types";
import type {
  PrReviewFileReviewStatus,
  PrReviewFileRiskLevel,
  PrReviewFileStatus,
  PrReviewRelationSource,
  PrReviewRelationType
} from "./types";

export interface PrReviewCanvasMaterializationFile {
  reviewFileId: string;
  roomFileId: string;
  reviewFlowFileId: string | null;
  flowId: string | null;
  flowSortOrder: number;
  workflowOrder: number;
  fileName: string;
  filePath: string;
  fileStatus: PrReviewFileStatus;
  roleSummary: string | null;
  riskLevel: PrReviewFileRiskLevel;
  reviewStatus: PrReviewFileReviewStatus;
}

export interface PrReviewCanvasMaterializationRelation {
  fromReviewFileId: string;
  toReviewFileId: string;
  fromRoomFileId: string;
  toRoomFileId: string;
  flowId: string;
  relationType: PrReviewRelationType | "review_order";
  source: PrReviewRelationSource | "fallback";
  confidence: number;
  reason: string;
}

export interface PrReviewCanvasMaterializedShape {
  id: string;
  values: CompleteShapeWriteValues;
}

export interface PrReviewCanvasMaterializationResult {
  shapes: PrReviewCanvasMaterializedShape[];
  activeShapeIds: string[];
}

const NODE_WIDTH = 272;
const NODE_HEIGHT = 116;
const GRID_COLUMNS = 4;
const GRID_START_X = 120;
const GRID_START_Y = 120;
const GRID_GAP_X = 72;
const GRID_GAP_Y = 64;
const COLLISION_MARGIN = 24;
const INDEX_DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const INDEX_DIGIT_WIDTH = 10;

export function buildPrReviewCanvasMaterialization(input: {
  reviewRoomId: string;
  reviewSessionId: string;
  files: PrReviewCanvasMaterializationFile[];
  relations: PrReviewCanvasMaterializationRelation[];
  existingShapes: CanvasShapeRow[];
}): PrReviewCanvasMaterializationResult {
  const existingById = new Map(
    input.existingShapes.map((shape) => [shape.id, shape])
  );
  const occupied = input.existingShapes
    .filter((shape) => shape.shape_type === PR_REVIEW_FILE_NODE_SHAPE_TYPE)
    .map(toBounds);
  const fileShapes = [...input.files]
    .sort(compareFiles)
    .map((file, index) => {
      const id = getPrReviewFileShapeId(file.roomFileId);
      const existing = existingById.get(id);
      const geometry = existing
        ? getExistingFileGeometry(existing)
        : allocateInitialGeometry(index, occupied);

      if (!existing) {
        occupied.push(toGeometryBounds(geometry));
      }

      return buildFileShape({
        existing,
        file,
        geometry,
        id,
        index,
        reviewRoomId: input.reviewRoomId,
        reviewSessionId: input.reviewSessionId
      });
    });
  const fileShapeByRoomFileId = new Map(
    fileShapes.map((shape) => [getRoomFileId(shape), shape])
  );
  const relationShapes = deduplicateRelations(input.relations)
    .sort(compareRelations)
    .flatMap((relation, index) => {
      const from = fileShapeByRoomFileId.get(relation.fromRoomFileId);
      const to = fileShapeByRoomFileId.get(relation.toRoomFileId);
      if (!from || !to || from.id === to.id) {
        return [];
      }

      const id = getPrReviewRelationShapeId(input.reviewRoomId, relation);
      return [
        buildRelationShape({
          existing: existingById.get(id),
          from,
          id,
          index,
          relation,
          reviewRoomId: input.reviewRoomId,
          reviewSessionId: input.reviewSessionId,
          to
        })
      ];
    });
  const shapes = [...relationShapes, ...fileShapes];

  return {
    shapes,
    activeShapeIds: shapes.map((shape) => shape.id)
  };
}

export function getPrReviewFileShapeId(roomFileId: string): string {
  return `shape:pr-review-file:${roomFileId}`;
}

export function getPrReviewRelationShapeId(
  reviewRoomId: string,
  relation: Pick<
    PrReviewCanvasMaterializationRelation,
    "fromRoomFileId" | "toRoomFileId" | "relationType"
  >
): string {
  const digest = createHash("sha256")
    .update(
      [
        reviewRoomId,
        relation.fromRoomFileId,
        relation.toRoomFileId,
        relation.relationType
      ].join("\u0000")
    )
    .digest("hex")
    .slice(0, 32);

  return `shape:pr-review-relation:${digest}`;
}

function buildFileShape(input: {
  existing: CanvasShapeRow | undefined;
  file: PrReviewCanvasMaterializationFile;
  geometry: ShapeGeometry;
  id: string;
  index: number;
  reviewRoomId: string;
  reviewSessionId: string;
}): PrReviewCanvasMaterializedShape {
  const { existing, file, geometry, id } = input;
  const zIndex = existing ? Number(existing.z_index) : 100 + input.index;
  const parentShapeId = existing?.parent_shape_id ?? null;
  const props = {
    w: geometry.width,
    h: geometry.height,
    reviewRoomId: input.reviewRoomId,
    roomFileId: file.roomFileId,
    currentReviewSessionId: input.reviewSessionId,
    reviewFileId: file.reviewFileId,
    reviewSessionId: input.reviewSessionId,
    reviewFlowFileId: file.reviewFlowFileId ?? "",
    flowId: file.flowId ?? "",
    workflowOrder: file.workflowOrder,
    fileName: file.fileName,
    filePath: file.filePath,
    fileStatus: file.fileStatus,
    roleSummary: file.roleSummary,
    riskLevel: file.riskLevel,
    reviewStatus: file.reviewStatus,
    conflictState: "none",
    conflictReason: null
  };
  const values: CompleteShapeWriteValues = {
    parentShapeId,
    shapeType: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
    title: file.fileName,
    textContent: file.filePath,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: existing ? Number(existing.rotation) : 0,
    zIndex,
    rawShape: buildRawShape({
      existing,
      id,
      parentShapeId,
      props,
      shapeType: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
      values: {
        x: geometry.x,
        y: geometry.y,
        rotation: existing ? Number(existing.rotation) : 0,
        zIndex
      }
    })
  };

  return { id, values };
}

function buildRelationShape(input: {
  existing: CanvasShapeRow | undefined;
  from: PrReviewCanvasMaterializedShape;
  id: string;
  index: number;
  relation: PrReviewCanvasMaterializationRelation;
  reviewRoomId: string;
  reviewSessionId: string;
  to: PrReviewCanvasMaterializedShape;
}): PrReviewCanvasMaterializedShape {
  const anchors = getAnchors(input.from.values, input.to.values);
  const x = Math.min(anchors.startX, anchors.endX);
  const y = Math.min(anchors.startY, anchors.endY);
  const width = Math.max(1, Math.abs(anchors.endX - anchors.startX));
  const height = Math.max(1, Math.abs(anchors.endY - anchors.startY));
  const zIndex = input.existing
    ? Number(input.existing.z_index)
    : input.index;
  const props = {
    w: width,
    h: height,
    startX: anchors.startX - x,
    startY: anchors.startY - y,
    endX: anchors.endX - x,
    endY: anchors.endY - y,
    fromReviewFileId: input.relation.fromReviewFileId,
    toReviewFileId: input.relation.toReviewFileId,
    flowId: input.relation.flowId,
    reason: input.relation.reason,
    kind:
      input.relation.relationType === "review_order"
        ? "review_order"
        : "semantic",
    reviewRoomId: input.reviewRoomId,
    currentReviewSessionId: input.reviewSessionId,
    fromRoomFileId: input.relation.fromRoomFileId,
    toRoomFileId: input.relation.toRoomFileId,
    relationType: input.relation.relationType,
    source: input.relation.source,
    confidence: input.relation.confidence
  };
  const values: CompleteShapeWriteValues = {
    parentShapeId: null,
    shapeType: PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
    title: null,
    textContent: input.relation.reason,
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex,
    rawShape: buildRawShape({
      existing: input.existing,
      id: input.id,
      parentShapeId: null,
      props,
      shapeType: PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
      values: { x, y, rotation: 0, zIndex }
    })
  };

  return { id: input.id, values };
}

function buildRawShape(input: {
  existing: CanvasShapeRow | undefined;
  id: string;
  parentShapeId: string | null;
  props: Record<string, unknown>;
  shapeType: string;
  values: { x: number; y: number; rotation: number; zIndex: number };
}): Record<string, unknown> {
  const existingRaw = input.existing?.raw_shape ?? {};
  const generatedIndex = getPrReviewCanvasShapeIndex(input.values.zIndex);
  const index =
    typeof existingRaw.index === "string" &&
    !isInvalidLegacyPrReviewCanvasIndex(existingRaw.index)
      ? existingRaw.index
      : generatedIndex;

  return {
    ...existingRaw,
    id: input.id,
    typeName: "shape",
    type: input.shapeType,
    x: input.values.x,
    y: input.values.y,
    rotation: input.values.rotation,
    index,
    parentId: input.parentShapeId ?? "page:page",
    isLocked:
      typeof existingRaw.isLocked === "boolean"
        ? existingRaw.isLocked
        : false,
    opacity:
      typeof existingRaw.opacity === "number" ? existingRaw.opacity : 1,
    meta: isRecord(existingRaw.meta) ? existingRaw.meta : {},
    props: input.props
  };
}

export function getPrReviewCanvasShapeIndex(zIndex: number): string {
  if (!Number.isSafeInteger(zIndex) || zIndex < 0) {
    throw new Error("PR Review Canvas zIndex must be a non-negative safe integer");
  }

  let remaining = zIndex;
  let encoded = "";
  do {
    encoded = INDEX_DIGITS[remaining % INDEX_DIGITS.length] + encoded;
    remaining = Math.floor(remaining / INDEX_DIGITS.length);
  } while (remaining > 0);

  return `a0${encoded.padStart(INDEX_DIGIT_WIDTH, "0")}1`;
}

function isInvalidLegacyPrReviewCanvasIndex(index: string): boolean {
  return index.length > 2 && /^a\d+0$/.test(index);
}

function allocateInitialGeometry(
  index: number,
  occupied: ShapeBounds[]
): ShapeGeometry {
  const column = index % GRID_COLUMNS;
  const row = Math.floor(index / GRID_COLUMNS);
  const candidate: ShapeGeometry = {
    x: GRID_START_X + column * (NODE_WIDTH + GRID_GAP_X),
    y: GRID_START_Y + row * (NODE_HEIGHT + GRID_GAP_Y),
    width: NODE_WIDTH,
    height: NODE_HEIGHT
  };

  while (occupied.some((bounds) => overlaps(candidate, bounds))) {
    candidate.y += NODE_HEIGHT + GRID_GAP_Y;
  }

  return candidate;
}

function getExistingFileGeometry(shape: CanvasShapeRow): ShapeGeometry {
  return {
    x: Number(shape.x),
    y: Number(shape.y),
    width: shape.width === null ? NODE_WIDTH : Number(shape.width),
    height: shape.height === null ? NODE_HEIGHT : Number(shape.height)
  };
}

function getAnchors(
  from: CompleteShapeWriteValues,
  to: CompleteShapeWriteValues
) {
  const fromWidth = from.width ?? 0;
  const fromHeight = from.height ?? 0;
  const toWidth = to.width ?? 0;
  const toHeight = to.height ?? 0;
  const fromCenterX = from.x + fromWidth / 2;
  const fromCenterY = from.y + fromHeight / 2;
  const toCenterX = to.x + toWidth / 2;
  const toCenterY = to.y + toHeight / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      startX: dx >= 0 ? from.x + fromWidth : from.x,
      startY: fromCenterY,
      endX: dx >= 0 ? to.x : to.x + toWidth,
      endY: toCenterY
    };
  }

  return {
    startX: fromCenterX,
    startY: dy >= 0 ? from.y + fromHeight : from.y,
    endX: toCenterX,
    endY: dy >= 0 ? to.y : to.y + toHeight
  };
}

function getRoomFileId(shape: PrReviewCanvasMaterializedShape): string {
  const props = shape.values.rawShape.props;
  if (!isRecord(props) || typeof props.roomFileId !== "string") {
    throw new Error("PR Review file shape roomFileId is required");
  }
  return props.roomFileId;
}

function deduplicateRelations(
  relations: PrReviewCanvasMaterializationRelation[]
): PrReviewCanvasMaterializationRelation[] {
  const unique = new Map<string, PrReviewCanvasMaterializationRelation>();
  for (const relation of relations) {
    const key = [
      relation.fromRoomFileId,
      relation.toRoomFileId,
      relation.relationType
    ].join("\u0000");
    if (!unique.has(key)) {
      unique.set(key, relation);
    }
  }
  return [...unique.values()];
}

function compareFiles(
  left: PrReviewCanvasMaterializationFile,
  right: PrReviewCanvasMaterializationFile
): number {
  return (
    left.flowSortOrder - right.flowSortOrder ||
    left.workflowOrder - right.workflowOrder ||
    left.filePath.localeCompare(right.filePath) ||
    left.roomFileId.localeCompare(right.roomFileId)
  );
}

function compareRelations(
  left: PrReviewCanvasMaterializationRelation,
  right: PrReviewCanvasMaterializationRelation
): number {
  return (
    left.flowId.localeCompare(right.flowId) ||
    left.fromRoomFileId.localeCompare(right.fromRoomFileId) ||
    left.toRoomFileId.localeCompare(right.toRoomFileId) ||
    left.relationType.localeCompare(right.relationType)
  );
}

function toBounds(shape: CanvasShapeRow): ShapeBounds {
  return {
    x: Number(shape.x),
    y: Number(shape.y),
    width: shape.width === null ? NODE_WIDTH : Number(shape.width),
    height: shape.height === null ? NODE_HEIGHT : Number(shape.height)
  };
}

function toGeometryBounds(geometry: ShapeGeometry): ShapeBounds {
  return { ...geometry };
}

function overlaps(left: ShapeBounds, right: ShapeBounds): boolean {
  return !(
    left.x + left.width + COLLISION_MARGIN <= right.x ||
    right.x + right.width + COLLISION_MARGIN <= left.x ||
    left.y + left.height + COLLISION_MARGIN <= right.y ||
    right.y + right.height + COLLISION_MARGIN <= left.y
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ShapeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ShapeBounds = ShapeGeometry;
