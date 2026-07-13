import { randomUUID } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type { DatabaseTransaction } from "../../database/database.service";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { CanvasOperationPublisherService } from "./canvas-operation-publisher.service";
import { computeShapeContentHash } from "./canvas-shape-hash";
import {
  attachShapeOperationMeta,
  mapCanvas,
  mapCanvasUserState,
  mapDeletedShape,
  mapShapeOperation,
  mapShape,
  mergeShapeWriteValues
} from "./canvas-shape.mapper";
import {
  validateCanvasTitle,
  validateShapeBatchOperations,
  validateShapeCreate,
  validateShapeId,
  validateShapeUpdate,
  validateViewSetting,
  validateCanvasOperationsAfterSeq,
  validateOptionalBaseRevision,
  validateOptionalClientOperationId,
  validateViewportBounds
} from "./canvas-shape.validation";
import {
  CanvasBoardDetailPayload,
  CanvasBoardPayload,
  CanvasLatestOperationSeqRow,
  CanvasLeavePayload,
  CanvasOperationsCatchupPayload,
  CanvasRow,
  CanvasShapeBatchPayload,
  CanvasShapeCleanupRow,
  CanvasShapeDeletePayload,
  CanvasShapeDeleteRow,
  CanvasShapeOperationPayload,
  CanvasShapeOperationRow,
  CanvasShapeOperationType,
  CanvasShapePayload,
  CanvasShapeRow,
  CanvasShapeSummaryPayload,
  CanvasUserStatePayload,
  CanvasUserStateRow,
  CanvasViewSettingPayload,
  CreateCanvasRequest,
  CreateCanvasShapeRequest,
  DeleteCanvasShapeRequest,
  ListCanvasOperationsQuery,
  ListCanvasShapesQuery,
  SyncCanvasShapesBatchRequest,
  UpdateCanvasShapeRequest,
  UpdateCanvasViewSettingRequest
} from "./canvas.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANVAS_SHAPE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const CANVAS_READ_ACCESS_SQL = `
  (
    c.board_type = 'freeform'
    OR (
      c.board_type = 'review'
      AND EXISTS (
        SELECT 1
        FROM pr_review_rooms AS review_room
        WHERE review_room.workspace_id = c.workspace_id
          AND review_room.canvas_id = c.id
      )
    )
  )
`;
const CANVAS_WRITE_ACCESS_SQL = `
  (
    c.board_type = 'freeform'
    OR (
      c.board_type = 'review'
      AND EXISTS (
        SELECT 1
        FROM pr_review_rooms AS review_room
        WHERE review_room.workspace_id = c.workspace_id
          AND review_room.canvas_id = c.id
          AND review_room.status = 'active'
      )
    )
  )
`;

type CanvasAccessMode = "read" | "write";

type CanvasShapeOperationWriteInput = {
  actorUserId: string;
  baseRevision: number | null;
  canvasId: string;
  clientOperationId: string | null;
  operationType: CanvasShapeOperationType;
  shapeId: string;
  workspaceId: string;
};

type CanvasShapeOperationWritePayload =
  | {
      operationPayload: Record<string, unknown>;
      payload: CanvasShapePayload;
    }
  | {
      operationPayload: Record<string, unknown>;
      payload: CanvasShapeDeletePayload;
    };

type CanvasShapeOperationWriteResult<TPayload> = {
  isNewOperation: boolean;
  operation: CanvasShapeOperationPayload;
  payload: TPayload;
};

type CanvasShapeStaleRevisionConflictDetails = {
  reason: "STALE_SHAPE_REVISION";
  shapeId: string;
  baseRevision: number;
  currentRevision: number;
  latestShape: CanvasShapePayload;
  latestOperation: CanvasShapeOperationPayload | null;
};

@Injectable()
export class CanvasService implements OnModuleDestroy, OnModuleInit {
  private canvasShapeCleanupInterval: ReturnType<typeof setInterval> | null =
    null;

  constructor(
    private readonly database: DatabaseService,
    private readonly operationPublisher: CanvasOperationPublisherService,
    private readonly workspaceService: WorkspaceService
  ) {}

  onModuleInit(): void {
    this.canvasShapeCleanupInterval = setInterval(() => {
      void this.cleanupDeletedFreeformShapes().catch((error: unknown) => {
        console.error("Canvas deleted shape cleanup failed", error);
      });
    }, CANVAS_SHAPE_CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.canvasShapeCleanupInterval) {
      clearInterval(this.canvasShapeCleanupInterval);
      this.canvasShapeCleanupInterval = null;
    }
  }

  async listCanvases(
    currentUserId: string,
    workspaceId: string
  ): Promise<CanvasBoardPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvases = await this.database.query<CanvasRow>(
      `
        SELECT
          c.id,
          c.workspace_id,
          c.title,
          c.board_type,
          c.zoom,
          c.viewport_x,
          c.viewport_y,
          c.updated_at,
          COUNT(s.id)::int AS shape_count
        FROM canvas c
        LEFT JOIN canvas_freeform_shapes s
          ON s.canvas_id = c.id
         AND s.deleted_at IS NULL
        WHERE c.workspace_id = $1
          AND c.board_type = 'freeform'
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.id ASC
      `,
      [workspaceId]
    );

    return canvases.map((canvas) => mapCanvas(canvas));
  }

  async createCanvas(
    currentUserId: string,
    workspaceId: string,
    input: CreateCanvasRequest
  ): Promise<CanvasBoardPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const title = validateCanvasTitle(input.title);
    const canvas = await this.database.queryOne<CanvasRow>(
      `
        INSERT INTO canvas (workspace_id, title, board_type, created_by)
        VALUES ($1, $2, 'freeform', $3)
        RETURNING
          id,
          workspace_id,
          title,
          board_type,
          zoom,
          viewport_x,
          viewport_y,
          updated_at,
          0::int AS shape_count
      `,
      [workspaceId, title, currentUserId]
    );

    if (!canvas) {
      throw badRequest("Canvas could not be created");
    }

    return mapCanvas(canvas);
  }

  async getCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasBoardDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const payload = mapCanvas(canvas);

    return {
      ...payload,
      shapes: [],
      viewSetting: {
        zoom: payload.zoom,
        viewportX: payload.viewportX,
        viewportY: payload.viewportY
      },
      userState: null
    };
  }

  async listShapesInViewport(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ListCanvasShapesQuery
  ): Promise<CanvasShapeSummaryPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const bounds = validateViewportBounds(input);
    if (bounds.parentShapeId !== null) {
      const shapes = await this.database.query<CanvasShapeRow>(
        `
          SELECT
            s.id,
            s.canvas_id,
            s.parent_shape_id,
            s.shape_type,
            s.title,
            s.text_content,
            s.x,
            s.y,
            s.width,
            s.height,
            s.rotation,
            s.z_index,
            s.raw_shape,
            s.content_hash,
            s.revision,
            child_counts.child_shape_count,
            s.created_at,
            s.updated_at,
            s.deleted_at
          FROM canvas_freeform_shapes s
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS child_shape_count
            FROM canvas_freeform_shapes child
            WHERE child.canvas_id = s.canvas_id
              AND child.parent_shape_id = s.id
              AND child.deleted_at IS NULL
          ) child_counts ON TRUE
          WHERE s.canvas_id = $1
            AND s.deleted_at IS NULL
            AND s.parent_shape_id = $2
          ORDER BY s.z_index ASC, s.updated_at ASC, s.id ASC
        `,
        [canvas.id, bounds.parentShapeId]
      );

      return shapes.map((shape) => mapShape(shape));
    }

    const minX = (bounds.x ?? 0) - (bounds.margin ?? 0);
    const minY = (bounds.y ?? 0) - (bounds.margin ?? 0);
    const maxX = (bounds.x ?? 0) + (bounds.width ?? 0) + (bounds.margin ?? 0);
    const maxY = (bounds.y ?? 0) + (bounds.height ?? 0) + (bounds.margin ?? 0);
    const shapes = await this.database.query<CanvasShapeRow>(
      `
        SELECT
          s.id,
          s.canvas_id,
          s.parent_shape_id,
          s.shape_type,
          s.title,
          s.text_content,
          s.x,
          s.y,
          s.width,
          s.height,
          s.rotation,
          s.z_index,
          s.raw_shape,
          s.content_hash,
          s.revision,
          child_counts.child_shape_count,
          s.created_at,
          s.updated_at,
          s.deleted_at
        FROM canvas_freeform_shapes s
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS child_shape_count
          FROM canvas_freeform_shapes child
          WHERE child.canvas_id = s.canvas_id
            AND child.parent_shape_id = s.id
            AND child.deleted_at IS NULL
        ) child_counts ON TRUE
        WHERE s.canvas_id = $1
          AND s.deleted_at IS NULL
          AND s.parent_shape_id IS NULL
          AND s.x <= $3
          AND s.max_x >= $2
          AND s.y <= $5
          AND s.max_y >= $4
        ORDER BY s.z_index ASC, s.updated_at ASC, s.id ASC
      `,
      [canvas.id, minX, maxX, minY, maxY]
    );

    return shapes.map((shape) => mapShape(shape));
  }

  async listOperationsAfterSeq(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ListCanvasOperationsQuery
  ): Promise<CanvasOperationsCatchupPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const afterSeq = validateCanvasOperationsAfterSeq(input);
    const latestSeqRow = await this.database.queryOne<CanvasLatestOperationSeqRow>(
      `
        SELECT latest_op_seq
        FROM canvas AS c
        WHERE c.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_READ_ACCESS_SQL}
      `,
      [canvas.id, workspaceId]
    );
    const operations = await this.database.query<CanvasShapeOperationRow>(
      `
        SELECT
          o.id,
          o.workspace_id,
          o.canvas_id,
          o.shape_id,
          o.actor_user_id,
          CASE
            WHEN o.operation_type <> 'delete'
              AND (s.id IS NULL OR s.deleted_at IS NOT NULL)
              THEN 'delete'
            ELSE o.operation_type
          END AS operation_type,
          o.op_seq,
          o.client_operation_id,
          o.base_revision,
          CASE
            WHEN o.operation_type <> 'delete'
              AND (s.id IS NULL OR s.deleted_at IS NOT NULL)
              THEN COALESCE(s.revision, o.result_revision)
            ELSE o.result_revision
          END AS result_revision,
          CASE
            WHEN o.operation_type <> 'delete'
              AND (s.id IS NULL OR s.deleted_at IS NOT NULL)
              THEN COALESCE(s.content_hash, o.content_hash)
            ELSE o.content_hash
          END AS content_hash,
          CASE
            WHEN o.operation_type <> 'delete'
              AND (s.id IS NULL OR s.deleted_at IS NOT NULL)
              THEN jsonb_build_object(
                'deletedShape',
                jsonb_build_object(
                  'id',
                  COALESCE(s.id, o.shape_id),
                  'deleted',
                  true,
                  'deletedAt',
                  COALESCE(s.deleted_at, o.created_at),
                  'contentHash',
                  COALESCE(s.content_hash, o.content_hash),
                  'revision',
                  COALESCE(s.revision, o.result_revision)
                )
              )
            ELSE o.payload
          END AS payload,
          o.created_at
        FROM canvas_shape_operations o
        LEFT JOIN canvas_freeform_shapes s
          ON s.id = o.shape_id
          AND s.canvas_id = o.canvas_id
        WHERE o.workspace_id = $1
          AND o.canvas_id = $2
          AND o.op_seq > $3
        ORDER BY o.op_seq ASC, o.created_at ASC, o.id ASC
        LIMIT 500
      `,
      [workspaceId, canvas.id, afterSeq]
    );

    return {
      latestOpSeq: Number(latestSeqRow?.latest_op_seq ?? 0),
      operations: operations.map((operation) => mapShapeOperation(operation))
    };
  }

  async createShape(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: CreateCanvasShapeRequest
  ): Promise<CanvasShapePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId, "write");
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const id = validateShapeId(input.id);
    const values = validateShapeCreate(input);
    const clientOperationId = validateOptionalClientOperationId(
      input.clientOperationId
    );
    const baseRevision = validateOptionalBaseRevision(input.baseRevision);
    const result = await this.database.transaction(async (transaction) =>
      this.writeShapeOperation<CanvasShapePayload>(
        transaction,
        {
          actorUserId: currentUserId,
          baseRevision,
          canvasId: canvas.id,
          clientOperationId,
          operationType: "create",
          shapeId: id,
          workspaceId
        },
        async () => {
          const contentHash = computeShapeContentHash(values);
          const shape = await transaction.queryOne<CanvasShapeRow>(
            `
              INSERT INTO canvas_freeform_shapes (
                id,
                canvas_id,
                parent_shape_id,
                shape_type,
                title,
                text_content,
                x,
                y,
                width,
                height,
                rotation,
                z_index,
                raw_shape,
                content_hash,
                deleted_at
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13::jsonb,
                $14,
                NULL
              )
              ON CONFLICT (id) DO UPDATE
              SET
                parent_shape_id = EXCLUDED.parent_shape_id,
                shape_type = EXCLUDED.shape_type,
                title = EXCLUDED.title,
                text_content = EXCLUDED.text_content,
                x = EXCLUDED.x,
                y = EXCLUDED.y,
                width = EXCLUDED.width,
                height = EXCLUDED.height,
                rotation = EXCLUDED.rotation,
                z_index = EXCLUDED.z_index,
                raw_shape = EXCLUDED.raw_shape,
                content_hash = EXCLUDED.content_hash,
                revision = canvas_freeform_shapes.revision + 1,
                deleted_at = NULL
              WHERE canvas_freeform_shapes.canvas_id = EXCLUDED.canvas_id
                AND canvas_freeform_shapes.deleted_at IS NOT NULL
              RETURNING
                id,
                canvas_id,
                parent_shape_id,
                shape_type,
                title,
                text_content,
                x,
                y,
                width,
                height,
                rotation,
                z_index,
                raw_shape,
                content_hash,
                revision,
                0::int AS child_shape_count,
                created_at,
                updated_at,
                deleted_at
            `,
            [
              id,
              canvas.id,
              values.parentShapeId,
              values.shapeType,
              values.title ?? null,
              values.textContent ?? null,
              values.x ?? 0,
              values.y ?? 0,
              values.width ?? null,
              values.height ?? null,
              values.rotation ?? 0,
              values.zIndex ?? 0,
              JSON.stringify(values.rawShape ?? {}),
              contentHash
            ]
          );

          if (!shape) {
            throw badRequest("Canvas shape could not be created");
          }

          const payload = mapShape(shape);

          return {
            operationPayload: { shape: payload },
            payload
          };
        }
      )
    );

    if (result.isNewOperation) {
      await this.publishShapeOperations([result.operation]);
    }

    return result.payload;
  }

  async syncShapesBatch(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: SyncCanvasShapesBatchRequest
  ): Promise<CanvasShapeBatchPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId, "write");
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const operations = validateShapeBatchOperations(input);

    const batchResult = await this.database.transaction(async (transaction) => {
      const result: CanvasShapeBatchPayload = {
        created: 0,
        updated: 0,
        deleted: 0,
        shapes: [],
        deletedShapes: []
      };
      const operationsToPublish: CanvasShapeOperationPayload[] = [];

      for (const operation of operations) {
        if (operation.type === "create") {
          const values = validateShapeCreate(operation.payload);
          const writeResult = await this.writeShapeOperation<CanvasShapePayload>(
            transaction,
            {
              actorUserId: currentUserId,
              baseRevision: operation.baseRevision,
              canvasId: canvas.id,
              clientOperationId: operation.clientOperationId,
              operationType: "create",
              shapeId: operation.shapeId,
              workspaceId
            },
            async () => {
              const contentHash = computeShapeContentHash(values);
              const shape = await transaction.queryOne<CanvasShapeRow>(
                `
                  INSERT INTO canvas_freeform_shapes (
                    id,
                    canvas_id,
                    parent_shape_id,
                    shape_type,
                    title,
                    text_content,
                    x,
                    y,
                    width,
                    height,
                    rotation,
                    z_index,
                    raw_shape,
                    content_hash,
                    deleted_at
                  )
                  VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9,
                    $10,
                    $11,
                    $12,
                    $13::jsonb,
                    $14,
                    NULL
                  )
                  ON CONFLICT (id) DO UPDATE
                  SET
                    parent_shape_id = EXCLUDED.parent_shape_id,
                    shape_type = EXCLUDED.shape_type,
                    title = EXCLUDED.title,
                    text_content = EXCLUDED.text_content,
                    x = EXCLUDED.x,
                    y = EXCLUDED.y,
                    width = EXCLUDED.width,
                    height = EXCLUDED.height,
                    rotation = EXCLUDED.rotation,
                    z_index = EXCLUDED.z_index,
                    raw_shape = EXCLUDED.raw_shape,
                    content_hash = EXCLUDED.content_hash,
                    revision = canvas_freeform_shapes.revision + 1,
                    deleted_at = NULL
                  WHERE canvas_freeform_shapes.canvas_id = EXCLUDED.canvas_id
                    AND canvas_freeform_shapes.deleted_at IS NOT NULL
                  RETURNING
                    id,
                    canvas_id,
                    parent_shape_id,
                    shape_type,
                    title,
                    text_content,
                    x,
                    y,
                    width,
                    height,
                    rotation,
                    z_index,
                    raw_shape,
                    content_hash,
                    revision,
                    0::int AS child_shape_count,
                    created_at,
                    updated_at,
                    deleted_at
                `,
                [
                  operation.shapeId,
                  canvas.id,
                  values.parentShapeId,
                  values.shapeType,
                  values.title ?? null,
                  values.textContent ?? null,
                  values.x ?? 0,
                  values.y ?? 0,
                  values.width ?? null,
                  values.height ?? null,
                  values.rotation ?? 0,
                  values.zIndex ?? 0,
                  JSON.stringify(values.rawShape ?? {}),
                  contentHash
                ]
              );

              if (!shape) {
                throw badRequest("Canvas shape could not be created");
              }

              const payload = mapShape(shape);

              return {
                operationPayload: { shape: payload },
                payload
              };
            }
          );

          result.created += 1;
          result.shapes.push(writeResult.payload);
          if (writeResult.isNewOperation) {
            operationsToPublish.push(writeResult.operation);
          }
          continue;
        }

        if (operation.type === "update") {
          const values = validateShapeUpdate(operation.payload);
          const writeResult = await this.writeShapeOperation<CanvasShapePayload>(
            transaction,
            {
              actorUserId: currentUserId,
              baseRevision: operation.baseRevision,
              canvasId: canvas.id,
              clientOperationId: operation.clientOperationId,
              operationType: "update",
              shapeId: operation.shapeId,
              workspaceId
            },
            async () => {
              const currentShape = await this.findActiveShapeForUpdate(
                transaction,
                canvas.id,
                operation.shapeId
              );

              if (!currentShape) {
                throw notFound("Canvas shape not found");
              }

              await this.assertFreshShapeBaseRevision(transaction, {
                baseRevision: operation.baseRevision,
                currentShape,
                shapeId: operation.shapeId,
                workspaceId
              });

              const mergedValues = mergeShapeWriteValues(currentShape, values);
              const contentHash = computeShapeContentHash(mergedValues);
              const shape = await transaction.queryOne<CanvasShapeRow>(
                `
                  UPDATE canvas_freeform_shapes s
                  SET
                    parent_shape_id = $3,
                    shape_type = $4,
                    title = $5,
                    text_content = $6,
                    x = $7,
                    y = $8,
                    width = $9,
                    height = $10,
                    rotation = $11,
                    z_index = $12,
                    raw_shape = $13::jsonb,
                    content_hash = $14,
                    revision = s.revision + 1
                  WHERE s.id = $1
                    AND s.canvas_id = $2
                    AND s.deleted_at IS NULL
                  RETURNING
                    s.id,
                    s.canvas_id,
                    s.parent_shape_id,
                    s.shape_type,
                    s.title,
                    s.text_content,
                    s.x,
                    s.y,
                    s.width,
                    s.height,
                    s.rotation,
                    s.z_index,
                    s.raw_shape,
                    s.content_hash,
                    s.revision,
                    0::int AS child_shape_count,
                    s.created_at,
                    s.updated_at,
                    s.deleted_at
                `,
                [
                  operation.shapeId,
                  canvas.id,
                  mergedValues.parentShapeId,
                  mergedValues.shapeType,
                  mergedValues.title,
                  mergedValues.textContent,
                  mergedValues.x,
                  mergedValues.y,
                  mergedValues.width,
                  mergedValues.height,
                  mergedValues.rotation,
                  mergedValues.zIndex,
                  JSON.stringify(mergedValues.rawShape),
                  contentHash
                ]
              );

              if (!shape) {
                throw notFound("Canvas shape not found");
              }

              const payload = mapShape(shape);

              return {
                operationPayload: { shape: payload },
                payload
              };
            }
          );

          result.updated += 1;
          result.shapes.push(writeResult.payload);
          if (writeResult.isNewOperation) {
            operationsToPublish.push(writeResult.operation);
          }
          continue;
        }

        const writeResult =
          await this.writeShapeOperation<CanvasShapeDeletePayload>(
            transaction,
            {
              actorUserId: currentUserId,
              baseRevision: operation.baseRevision,
              canvasId: canvas.id,
              clientOperationId: operation.clientOperationId,
              operationType: "delete",
              shapeId: operation.shapeId,
              workspaceId
            },
            async () => {
              const currentShape = await this.findActiveShapeForUpdate(
                transaction,
                canvas.id,
                operation.shapeId
              );

              if (!currentShape) {
                throw notFound("Canvas shape not found");
              }

              await this.assertFreshShapeBaseRevision(transaction, {
                baseRevision: operation.baseRevision,
                currentShape,
                shapeId: operation.shapeId,
                workspaceId
              });

              const shape = await transaction.queryOne<CanvasShapeDeleteRow>(
                `
                  UPDATE canvas_freeform_shapes s
                  SET
                    deleted_at = now(),
                    revision = s.revision + 1
                  WHERE s.id = $1
                    AND s.canvas_id = $2
                    AND s.deleted_at IS NULL
                  RETURNING s.id, s.content_hash, s.revision, s.deleted_at
                `,
                [operation.shapeId, canvas.id]
              );

              if (!shape || !shape.deleted_at) {
                throw notFound("Canvas shape not found");
              }

              const payload = mapDeletedShape(shape);

              return {
                operationPayload: { deletedShape: payload },
                payload
              };
            }
          );

        result.deleted += 1;
        result.deletedShapes.push(writeResult.payload);
        if (writeResult.isNewOperation) {
          operationsToPublish.push(writeResult.operation);
        }
      }

      return { operationsToPublish, payload: result };
    });

    await this.publishShapeOperations(batchResult.operationsToPublish);

    return batchResult.payload;
  }

  async getShapeDetail(
    currentUserId: string,
    workspaceId: string,
    shapeId: string
  ): Promise<CanvasShapePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const id = validateShapeId(shapeId);
    const shape = await this.database.queryOne<CanvasShapeRow>(
      `
        SELECT
          s.id,
          s.canvas_id,
          s.parent_shape_id,
          s.shape_type,
          s.title,
          s.text_content,
          s.x,
          s.y,
          s.width,
          s.height,
          s.rotation,
          s.z_index,
          s.raw_shape,
          s.content_hash,
          s.revision,
          child_counts.child_shape_count,
          s.created_at,
          s.updated_at,
          s.deleted_at
        FROM canvas_freeform_shapes s
        INNER JOIN canvas c ON c.id = s.canvas_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS child_shape_count
          FROM canvas_freeform_shapes child
          WHERE child.canvas_id = s.canvas_id
            AND child.parent_shape_id = s.id
            AND child.deleted_at IS NULL
        ) child_counts ON TRUE
        WHERE s.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_READ_ACCESS_SQL}
          AND s.deleted_at IS NULL
      `,
      [id, workspaceId]
    );

    if (!shape) {
      throw notFound("Canvas shape not found");
    }

    return mapShape(shape);
  }

  async enterCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasUserStatePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const userState = await this.database.queryOne<CanvasUserStateRow>(
      `
        INSERT INTO canvas_user_states (
          canvas_id,
          user_id,
          entered_at,
          left_at
        )
        VALUES ($1, $2, now(), NULL)
        ON CONFLICT (canvas_id, user_id)
        DO UPDATE SET
          entered_at = now(),
          left_at = NULL
        RETURNING
          canvas_id,
          user_id,
          entered_at,
          left_at
      `,
      [canvas.id, currentUserId]
    );

    if (!userState) {
      throw badRequest("Canvas user state could not be recorded");
    }

    return mapCanvasUserState(userState);
  }

  async leaveCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasLeavePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    return this.database.transaction(async (transaction) => {
      const userState = await transaction.queryOne<CanvasUserStateRow>(
        `
          INSERT INTO canvas_user_states (
            canvas_id,
            user_id,
            entered_at,
            left_at
          )
          VALUES ($1, $2, now(), now())
          ON CONFLICT (canvas_id, user_id)
          DO UPDATE SET
            left_at = now()
          RETURNING
            canvas_id,
            user_id,
            entered_at,
            left_at
        `,
        [canvas.id, currentUserId]
      );

      if (!userState) {
        throw badRequest("Canvas user state could not be recorded");
      }

      return {
        ...mapCanvasUserState(userState),
        permanentlyDeletedShapeCount: 0
      };
    });
  }

  async updateViewSetting(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: UpdateCanvasViewSettingRequest
  ): Promise<CanvasViewSettingPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId, "write");
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const values = validateViewSetting(input);
    const updatedCanvas = await this.database.queryOne<CanvasRow>(
      `
        UPDATE canvas AS c
        SET
          zoom = $3,
          viewport_x = $4,
          viewport_y = $5
        WHERE c.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_WRITE_ACCESS_SQL}
        RETURNING
          id,
          workspace_id,
          title,
          board_type,
          zoom,
          viewport_x,
          viewport_y,
          updated_at,
          0::int AS shape_count
      `,
      [canvas.id, workspaceId, values.zoom, values.viewportX, values.viewportY]
    );

    if (!updatedCanvas) {
      throw notFound("Canvas not found");
    }

    const payload = mapCanvas(updatedCanvas);

    return {
      zoom: payload.zoom,
      viewportX: payload.viewportX,
      viewportY: payload.viewportY
    };
  }

  async updateShape(
    currentUserId: string,
    workspaceId: string,
    shapeId: string,
    input: UpdateCanvasShapeRequest
  ): Promise<CanvasShapePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const id = validateShapeId(shapeId);
    const values = validateShapeUpdate(input);
    const clientOperationId = validateOptionalClientOperationId(
      input.clientOperationId
    );
    const baseRevision = validateOptionalBaseRevision(input.baseRevision);
    const targetShape = await this.database.queryOne<CanvasShapeRow>(
      `
        SELECT
          s.id,
          s.canvas_id,
          s.parent_shape_id,
          s.shape_type,
          s.title,
          s.text_content,
          s.x,
          s.y,
          s.width,
          s.height,
          s.rotation,
          s.z_index,
          s.raw_shape,
          s.content_hash,
          s.revision,
          s.created_at,
          s.updated_at,
          s.deleted_at
        FROM canvas_freeform_shapes s
        INNER JOIN canvas c ON c.id = s.canvas_id
        WHERE s.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_WRITE_ACCESS_SQL}
          AND s.deleted_at IS NULL
      `,
      [id, workspaceId]
    );

    if (!targetShape) {
      throw notFound("Canvas shape not found");
    }

    const result = await this.database.transaction(async (transaction) =>
      this.writeShapeOperation<CanvasShapePayload>(
        transaction,
        {
          actorUserId: currentUserId,
          baseRevision,
          canvasId: targetShape.canvas_id,
          clientOperationId,
          operationType: "update",
          shapeId: id,
          workspaceId
        },
        async () => {
          const currentShape = await this.findActiveShapeForUpdate(
            transaction,
            targetShape.canvas_id,
            id
          );

          if (!currentShape) {
            throw notFound("Canvas shape not found");
          }

          await this.assertFreshShapeBaseRevision(transaction, {
            baseRevision,
            currentShape,
            shapeId: id,
            workspaceId
          });

          const mergedValues = mergeShapeWriteValues(currentShape, values);
          const contentHash = computeShapeContentHash(mergedValues);

          const shape = await transaction.queryOne<CanvasShapeRow>(
            `
              UPDATE canvas_freeform_shapes s
              SET
                parent_shape_id = $3,
                shape_type = $4,
                title = $5,
                text_content = $6,
                x = $7,
                y = $8,
                width = $9,
                height = $10,
                rotation = $11,
                z_index = $12,
                raw_shape = $13::jsonb,
                content_hash = $14,
                revision = s.revision + 1
              WHERE s.id = $1
                AND s.canvas_id = $2
                AND s.deleted_at IS NULL
              RETURNING
                s.id,
                s.canvas_id,
                s.parent_shape_id,
                s.shape_type,
                s.title,
                s.text_content,
                s.x,
                s.y,
                s.width,
                s.height,
                s.rotation,
                s.z_index,
                s.raw_shape,
                s.content_hash,
                s.revision,
                0::int AS child_shape_count,
                s.created_at,
                s.updated_at,
                s.deleted_at
            `,
            [
              id,
              targetShape.canvas_id,
              mergedValues.parentShapeId,
              mergedValues.shapeType,
              mergedValues.title,
              mergedValues.textContent,
              mergedValues.x,
              mergedValues.y,
              mergedValues.width,
              mergedValues.height,
              mergedValues.rotation,
              mergedValues.zIndex,
              JSON.stringify(mergedValues.rawShape),
              contentHash
            ]
          );

          if (!shape) {
            throw notFound("Canvas shape not found");
          }

          const payload = mapShape(shape);

          return {
            operationPayload: { shape: payload },
            payload
          };
        }
      )
    );

    if (result.isNewOperation) {
      await this.publishShapeOperations([result.operation]);
    }

    return result.payload;
  }

  async deleteShape(
    currentUserId: string,
    workspaceId: string,
    shapeId: string,
    input: DeleteCanvasShapeRequest | undefined
  ): Promise<CanvasShapeDeletePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const id = validateShapeId(shapeId);
    const clientOperationId = validateOptionalClientOperationId(
      input?.clientOperationId
    );
    const baseRevision = validateOptionalBaseRevision(input?.baseRevision);
    const targetShape = await this.database.queryOne<CanvasShapeRow>(
      `
        SELECT
          s.id,
          s.canvas_id,
          s.parent_shape_id,
          s.shape_type,
          s.title,
          s.text_content,
          s.x,
          s.y,
          s.width,
          s.height,
          s.rotation,
          s.z_index,
          s.raw_shape,
          s.content_hash,
          s.revision,
          s.created_at,
          s.updated_at,
          s.deleted_at
        FROM canvas_freeform_shapes s
        INNER JOIN canvas c ON c.id = s.canvas_id
        WHERE s.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_WRITE_ACCESS_SQL}
          AND s.deleted_at IS NULL
      `,
      [id, workspaceId]
    );

    if (!targetShape) {
      throw notFound("Canvas shape not found");
    }

    const result = await this.database.transaction(async (transaction) =>
      this.writeShapeOperation<CanvasShapeDeletePayload>(
        transaction,
        {
          actorUserId: currentUserId,
          baseRevision,
          canvasId: targetShape.canvas_id,
          clientOperationId,
          operationType: "delete",
          shapeId: id,
          workspaceId
        },
        async () => {
          const currentShape = await this.findActiveShapeForUpdate(
            transaction,
            targetShape.canvas_id,
            id
          );

          if (!currentShape) {
            throw notFound("Canvas shape not found");
          }

          await this.assertFreshShapeBaseRevision(transaction, {
            baseRevision,
            currentShape,
            shapeId: id,
            workspaceId
          });

          const shape = await transaction.queryOne<CanvasShapeDeleteRow>(
            `
              UPDATE canvas_freeform_shapes s
              SET
                deleted_at = now(),
                revision = s.revision + 1
              WHERE s.id = $1
                AND s.canvas_id = $2
                AND s.deleted_at IS NULL
              RETURNING s.id, s.content_hash, s.revision, s.deleted_at
            `,
            [id, targetShape.canvas_id]
          );

          if (!shape || !shape.deleted_at) {
            throw notFound("Canvas shape not found");
          }

          const payload = mapDeletedShape(shape);

          return {
            operationPayload: { deletedShape: payload },
            payload
          };
        }
      )
    );

    if (result.isNewOperation) {
      await this.publishShapeOperations([result.operation]);
    }

    return result.payload;
  }

  private async writeShapeOperation<TPayload extends CanvasShapeDeletePayload | CanvasShapePayload>(
    transaction: DatabaseTransaction,
    input: CanvasShapeOperationWriteInput,
    writePayload: () => Promise<CanvasShapeOperationWritePayload>
  ): Promise<CanvasShapeOperationWriteResult<TPayload>> {
    const clientOperationId = input.clientOperationId ?? randomUUID();
    const lockedCanvas = await transaction.queryOne<CanvasLatestOperationSeqRow>(
      `
        SELECT latest_op_seq
        FROM canvas AS c
        WHERE c.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_WRITE_ACCESS_SQL}
        FOR UPDATE
      `,
      [input.canvasId, input.workspaceId]
    );

    if (!lockedCanvas) {
      throw notFound("Canvas not found");
    }

    const existingOperation = await this.findShapeOperationByClientId(
      transaction,
      input.canvasId,
      input.actorUserId,
      clientOperationId
    );

    if (existingOperation) {
      const operation = mapShapeOperation(existingOperation);

      if (
        operation.operationType !== input.operationType ||
        operation.shapeId !== input.shapeId
      ) {
        throw badRequest("Canvas clientOperationId was already used");
      }

      return {
        isNewOperation: false,
        operation,
        payload: this.readPayloadFromOperation<TPayload>(operation)
      };
    }

    const writeResult = await writePayload();
    const resultRevision = writeResult.payload.revision;
    const contentHash = writeResult.payload.contentHash;
    const nextOpSeq = Number(lockedCanvas.latest_op_seq) + 1;

    await transaction.execute(
      `
        UPDATE canvas AS c
        SET latest_op_seq = $3
        WHERE c.id = $1
          AND c.workspace_id = $2
          AND ${CANVAS_WRITE_ACCESS_SQL}
      `,
      [input.canvasId, input.workspaceId, nextOpSeq]
    );

    const operationRow = await transaction.queryOne<CanvasShapeOperationRow>(
      `
        INSERT INTO canvas_shape_operations (
          workspace_id,
          canvas_id,
          shape_id,
          actor_user_id,
          operation_type,
          op_seq,
          client_operation_id,
          base_revision,
          result_revision,
          content_hash,
          payload
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11::jsonb
        )
        RETURNING
          id,
          workspace_id,
          canvas_id,
          shape_id,
          actor_user_id,
          operation_type,
          op_seq,
          client_operation_id,
          base_revision,
          result_revision,
          content_hash,
          payload,
          created_at
      `,
      [
        input.workspaceId,
        input.canvasId,
        input.shapeId,
        input.actorUserId,
        input.operationType,
        nextOpSeq,
        clientOperationId,
        input.baseRevision,
        resultRevision,
        contentHash,
        JSON.stringify(writeResult.operationPayload)
      ]
    );

    if (!operationRow) {
      throw badRequest("Canvas shape operation could not be recorded");
    }

    const operation = mapShapeOperation(operationRow);

    return {
      isNewOperation: true,
      operation,
      payload: attachShapeOperationMeta(
        writeResult.payload,
        operation
      ) as TPayload
    };
  }

  private async findActiveShapeForUpdate(
    transaction: DatabaseTransaction,
    canvasId: string,
    shapeId: string
  ): Promise<CanvasShapeRow | null> {
    return transaction.queryOne<CanvasShapeRow>(
      `
        SELECT
          id,
          canvas_id,
          parent_shape_id,
          shape_type,
          title,
          text_content,
          x,
          y,
          width,
          height,
          rotation,
          z_index,
          raw_shape,
          content_hash,
          revision,
          created_at,
          updated_at,
          deleted_at
        FROM canvas_freeform_shapes
        WHERE id = $1
          AND canvas_id = $2
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [shapeId, canvasId]
    );
  }

  private async assertFreshShapeBaseRevision(
    transaction: DatabaseTransaction,
    {
      baseRevision,
      currentShape,
      shapeId,
      workspaceId
    }: {
      baseRevision: number | null;
      currentShape: CanvasShapeRow;
      shapeId: string;
      workspaceId: string;
    }
  ): Promise<void> {
    if (baseRevision === null) {
      return;
    }

    const currentRevision = Number(currentShape.revision);

    if (baseRevision === currentRevision) {
      return;
    }

    const latestOperation = await this.findLatestShapeOperation(
      transaction,
      workspaceId,
      currentShape.canvas_id,
      shapeId
    );

    const details: CanvasShapeStaleRevisionConflictDetails = {
      reason: "STALE_SHAPE_REVISION",
      shapeId,
      baseRevision,
      currentRevision,
      latestShape: mapShape(currentShape),
      latestOperation: latestOperation
        ? mapShapeOperation(latestOperation)
        : null
    };

    throw new HttpException(
      {
        success: false,
        error: {
          code: "CONFLICT",
          message: "Canvas shape has changed since the requested baseRevision",
          details
        }
      },
      HttpStatus.CONFLICT
    );
  }

  private async findLatestShapeOperation(
    transaction: DatabaseTransaction,
    workspaceId: string,
    canvasId: string,
    shapeId: string
  ): Promise<CanvasShapeOperationRow | null> {
    return transaction.queryOne<CanvasShapeOperationRow>(
      `
        SELECT
          id,
          workspace_id,
          canvas_id,
          shape_id,
          actor_user_id,
          operation_type,
          op_seq,
          client_operation_id,
          base_revision,
          result_revision,
          content_hash,
          payload,
          created_at
        FROM canvas_shape_operations
        WHERE workspace_id = $1
          AND canvas_id = $2
          AND shape_id = $3
        ORDER BY op_seq DESC, created_at DESC, id DESC
        LIMIT 1
      `,
      [workspaceId, canvasId, shapeId]
    );
  }

  private async findShapeOperationByClientId(
    transaction: DatabaseTransaction,
    canvasId: string,
    actorUserId: string,
    clientOperationId: string
  ): Promise<CanvasShapeOperationRow | null> {
    return transaction.queryOne<CanvasShapeOperationRow>(
      `
        SELECT
          id,
          workspace_id,
          canvas_id,
          shape_id,
          actor_user_id,
          operation_type,
          op_seq,
          client_operation_id,
          base_revision,
          result_revision,
          content_hash,
          payload,
          created_at
        FROM canvas_shape_operations
        WHERE canvas_id = $1
          AND actor_user_id = $2
          AND client_operation_id = $3
      `,
      [canvasId, actorUserId, clientOperationId]
    );
  }

  private readPayloadFromOperation<
    TPayload extends CanvasShapeDeletePayload | CanvasShapePayload
  >(operation: CanvasShapeOperationPayload): TPayload {
    const payloadKey =
      operation.operationType === "delete" ? "deletedShape" : "shape";
    const payload = operation.payload[payloadKey];

    if (!this.isRecord(payload)) {
      throw badRequest("Canvas shape operation payload is invalid");
    }

    return attachShapeOperationMeta(
      payload as TPayload,
      operation
    ) as TPayload;
  }

  private async publishShapeOperations(
    operations: CanvasShapeOperationPayload[]
  ): Promise<void> {
    for (const operation of operations) {
      try {
        await this.operationPublisher.publishOperation(operation);
      } catch (error) {
        console.error("Canvas shape operation publish failed", error);
      }
    }
  }

  private async cleanupDeletedFreeformShapes(): Promise<number> {
    const cleanup = await this.database.queryOne<CanvasShapeCleanupRow>(
      `
        WITH deleted_shapes AS (
          DELETE FROM canvas_freeform_shapes
          WHERE deleted_at IS NOT NULL
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count
        FROM deleted_shapes
      `
    );

    return Number(cleanup?.deleted_count ?? 0);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private async findCanvas(
    workspaceId: string,
    canvasId: string,
    accessMode: CanvasAccessMode = "read"
  ): Promise<CanvasRow | null> {
    if (!UUID_PATTERN.test(canvasId)) {
      return null;
    }

    const accessSql =
      accessMode === "write"
        ? CANVAS_WRITE_ACCESS_SQL
        : CANVAS_READ_ACCESS_SQL;

    return this.database.queryOne<CanvasRow>(
      `
        SELECT
          c.id,
          c.workspace_id,
          c.title,
          c.board_type,
          c.zoom,
          c.viewport_x,
          c.viewport_y,
          c.updated_at,
          COUNT(s.id)::int AS shape_count
        FROM canvas c
        LEFT JOIN canvas_freeform_shapes s
          ON s.canvas_id = c.id
         AND s.deleted_at IS NULL
        WHERE c.id = $1
          AND c.workspace_id = $2
          AND ${accessSql}
        GROUP BY c.id
      `,
      [canvasId, workspaceId]
    );
  }

}
