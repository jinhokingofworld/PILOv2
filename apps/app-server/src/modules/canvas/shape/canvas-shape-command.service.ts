import { randomUUID } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ActivityLogService } from "../../../common/activity-log.service";
import type { DatabaseTransaction } from "../../../database/database.service";
import { badRequest, notFound } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import { CanvasOperationPublisherService } from "../operation/canvas-operation-publisher.service";
import {
  buildCanvasShapeActivityLog,
  type CanvasActivityActorType
} from "../operation/canvas-activity-log";
import {
  assertUserCanCreateCanvasShape,
  assertUserCanDeleteCanvasShape,
  prepareUserCanvasShapeUpdate
} from "../policies/canvas-review-shape-policy";
import {
  CANVAS_WRITE_ACCESS_SQL,
  CanvasAccessService
} from "../policies/canvas-access.service";
import { computeShapeContentHash } from "./canvas-shape-hash";
import {
  attachShapeOperationMeta,
  mapDeletedShape,
  mapShapeOperation,
  mapShape,
  mergeShapeWriteValues
} from "./canvas-shape.mapper";
import {
  validateShapeBatchOperations,
  validateShapeCreate,
  validateShapeId,
  validateShapeUpdate,
  validateOptionalBaseRevision,
  validateOptionalClientOperationId
} from "./canvas-shape.validation";
import {
  CanvasLatestOperationSeqRow,
  CanvasShapeBatchPayload,
  CanvasShapeDeletePayload,
  CanvasShapeDeleteRow,
  CanvasShapeOperationPayload,
  CanvasShapeOperationRow,
  CanvasShapeOperationType,
  CanvasShapePayload,
  CanvasShapeRow,
  CreateCanvasShapeRequest,
  DeleteCanvasShapeRequest,
  SyncCanvasShapesBatchRequest,
  UpdateCanvasShapeRequest
} from "../contracts/canvas.types";

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
export class CanvasShapeCommandService {
  constructor(
    private readonly activityLogService: ActivityLogService,
    private readonly canvasAccess: CanvasAccessService,
    private readonly database: DatabaseService,
    private readonly operationPublisher: CanvasOperationPublisherService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async createShape(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: CreateCanvasShapeRequest
  ): Promise<CanvasShapePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(
      workspaceId,
      canvasId,
      "write"
    );
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const id = validateShapeId(input.id);
    const values = validateShapeCreate(input);
    assertUserCanCreateCanvasShape(values.shapeType);
    const clientOperationId = validateOptionalClientOperationId(
      input.clientOperationId
    );
    const baseRevision = validateOptionalBaseRevision(input.baseRevision);
    const result = await this.database.transaction(async (transaction) => {
      const writeResult = await this.writeShapeOperation<CanvasShapePayload>(
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
      );

      await this.appendShapeActivityLog(transaction, writeResult, "user", {
        after: writeResult.payload
      });

      return writeResult;
    });

    if (result.isNewOperation) {
      await this.publishShapeOperations([result.operation]);
    }

    return result.payload;
  }

  async syncShapesBatch(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: SyncCanvasShapesBatchRequest,
    actorType: CanvasActivityActorType = "user"
  ): Promise<CanvasShapeBatchPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(
      workspaceId,
      canvasId,
      "write"
    );
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
          assertUserCanCreateCanvasShape(values.shapeType);
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

          await this.appendShapeActivityLog(transaction, writeResult, actorType, {
            after: writeResult.payload
          });

          result.created += 1;
          result.shapes.push(writeResult.payload);
          if (writeResult.isNewOperation) {
            operationsToPublish.push(writeResult.operation);
          }
          continue;
        }

        if (operation.type === "update") {
          const values = validateShapeUpdate(operation.payload);
          let activityBefore: CanvasShapePayload | undefined;
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

              activityBefore = mapShape(currentShape);

              const permittedValues = prepareUserCanvasShapeUpdate(
                currentShape,
                values
              );

              await this.assertFreshShapeBaseRevision(transaction, {
                baseRevision: operation.baseRevision,
                currentShape,
                shapeId: operation.shapeId,
                workspaceId
              });

              const mergedValues = mergeShapeWriteValues(
                currentShape,
                permittedValues
              );
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

          await this.appendShapeActivityLog(transaction, writeResult, actorType, {
            after: writeResult.payload,
            before: activityBefore
          });

          result.updated += 1;
          result.shapes.push(writeResult.payload);
          if (writeResult.isNewOperation) {
            operationsToPublish.push(writeResult.operation);
          }
          continue;
        }

        let activityBefore: CanvasShapePayload | undefined;
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

              activityBefore = mapShape(currentShape);

              assertUserCanDeleteCanvasShape(currentShape);

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

        await this.appendShapeActivityLog(transaction, writeResult, actorType, {
          before: activityBefore
        });

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

    const result = await this.database.transaction(async (transaction) => {
      let activityBefore: CanvasShapePayload | undefined;
      const writeResult = await this.writeShapeOperation<CanvasShapePayload>(
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

          activityBefore = mapShape(currentShape);

          const permittedValues = prepareUserCanvasShapeUpdate(
            currentShape,
            values
          );

          await this.assertFreshShapeBaseRevision(transaction, {
            baseRevision,
            currentShape,
            shapeId: id,
            workspaceId
          });

          const mergedValues = mergeShapeWriteValues(
            currentShape,
            permittedValues
          );
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
      );

      await this.appendShapeActivityLog(transaction, writeResult, "user", {
        after: writeResult.payload,
        before: activityBefore
      });

      return writeResult;
    });

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

    const result = await this.database.transaction(async (transaction) => {
      let activityBefore: CanvasShapePayload | undefined;
      const writeResult =
        await this.writeShapeOperation<CanvasShapeDeletePayload>(
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

            activityBefore = mapShape(currentShape);

            assertUserCanDeleteCanvasShape(currentShape);

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
        );

      await this.appendShapeActivityLog(transaction, writeResult, "user", {
        before: activityBefore
      });

      return writeResult;
    });

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

  private async appendShapeActivityLog(
    transaction: DatabaseTransaction,
    writeResult: CanvasShapeOperationWriteResult<
      CanvasShapeDeletePayload | CanvasShapePayload
    >,
    actorType: CanvasActivityActorType,
    shapes: {
      after?: CanvasShapePayload;
      before?: CanvasShapePayload;
    }
  ): Promise<void> {
    if (!writeResult.isNewOperation) {
      return;
    }

    const activityLog = buildCanvasShapeActivityLog({
      actorType,
      after: shapes.after,
      before: shapes.before,
      operation: writeResult.operation
    });

    if (activityLog) {
      await this.activityLogService.append(transaction, activityLog);
    }
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
