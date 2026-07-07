import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { computeShapeContentHash } from "./canvas-shape-hash";
import {
  mapCanvas,
  mapCanvasUserState,
  mapDeletedShape,
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
  validateViewportBounds
} from "./canvas-shape.validation";
import {
  CanvasBoardDetailPayload,
  CanvasBoardPayload,
  CanvasLeavePayload,
  CanvasRow,
  CanvasShapeBatchPayload,
  CanvasShapeCleanupRow,
  CanvasShapeDeletePayload,
  CanvasShapeDeleteRow,
  CanvasShapePayload,
  CanvasShapeRow,
  CanvasShapeSummaryPayload,
  CanvasUserStatePayload,
  CanvasUserStateRow,
  CanvasViewSettingPayload,
  CreateCanvasRequest,
  CreateCanvasShapeRequest,
  ListCanvasShapesQuery,
  SyncCanvasShapesBatchRequest,
  UpdateCanvasShapeRequest,
  UpdateCanvasViewSettingRequest
} from "./canvas.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CanvasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

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
    const minX = bounds.x - bounds.margin;
    const minY = bounds.y - bounds.margin;
    const maxX = bounds.x + bounds.width + bounds.margin;
    const maxY = bounds.y + bounds.height + bounds.margin;
    const shapes = await this.database.query<CanvasShapeRow>(
      `
        SELECT
          id,
          canvas_id,
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
        WHERE canvas_id = $1
          AND deleted_at IS NULL
          AND x <= $3
          AND max_x >= $2
          AND y <= $5
          AND max_y >= $4
        ORDER BY z_index ASC, updated_at ASC, id ASC
      `,
      [canvas.id, minX, maxX, minY, maxY]
    );

    return shapes.map((shape) => mapShape(shape));
  }

  async createShape(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: CreateCanvasShapeRequest
  ): Promise<CanvasShapePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const id = validateShapeId(input.id);
    const values = validateShapeCreate(input);
    const contentHash = computeShapeContentHash(values);
    const shape = await this.database.queryOne<CanvasShapeRow>(
      `
        INSERT INTO canvas_freeform_shapes (
          id,
          canvas_id,
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
          $12::jsonb,
          $13,
          NULL
        )
        ON CONFLICT (id) DO UPDATE
        SET
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
      `,
      [
        id,
        canvas.id,
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

    return mapShape(shape);
  }

  async syncShapesBatch(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: SyncCanvasShapesBatchRequest
  ): Promise<CanvasShapeBatchPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const operations = validateShapeBatchOperations(input);

    return this.database.transaction(async (transaction) => {
      const result: CanvasShapeBatchPayload = {
        created: 0,
        updated: 0,
        deleted: 0,
        shapes: [],
        deletedShapes: []
      };

      for (const operation of operations) {
        if (operation.type === "create") {
          const values = validateShapeCreate(operation.payload);
          const contentHash = computeShapeContentHash(values);
          const shape = await transaction.queryOne<CanvasShapeRow>(
            `
              INSERT INTO canvas_freeform_shapes (
                id,
                canvas_id,
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
                $12::jsonb,
                $13,
                NULL
              )
              ON CONFLICT (id) DO UPDATE
              SET
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
            `,
            [
              operation.shapeId,
              canvas.id,
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

          result.created += 1;
          result.shapes.push(mapShape(shape));
          continue;
        }

        if (operation.type === "update") {
          const values = validateShapeUpdate(operation.payload);
          const currentShape = await transaction.queryOne<CanvasShapeRow>(
            `
              SELECT
                id,
                canvas_id,
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
            [operation.shapeId, canvas.id]
          );

          if (!currentShape) {
            throw notFound("Canvas shape not found");
          }

          const mergedValues = mergeShapeWriteValues(currentShape, values);
          const contentHash = computeShapeContentHash(mergedValues);
          const shape = await transaction.queryOne<CanvasShapeRow>(
            `
              UPDATE canvas_freeform_shapes s
              SET
                shape_type = $3,
                title = $4,
                text_content = $5,
                x = $6,
                y = $7,
                width = $8,
                height = $9,
                rotation = $10,
                z_index = $11,
                raw_shape = $12::jsonb,
                content_hash = $13,
                revision = s.revision + 1
              WHERE s.id = $1
                AND s.canvas_id = $2
                AND s.deleted_at IS NULL
              RETURNING
                s.id,
                s.canvas_id,
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
            `,
            [
              operation.shapeId,
              canvas.id,
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

          result.updated += 1;
          result.shapes.push(mapShape(shape));
          continue;
        }

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

        result.deleted += 1;
        result.deletedShapes.push(mapDeletedShape(shape));
      }

      return result;
    });
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
          AND c.board_type = 'freeform'
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

      const cleanup = await transaction.queryOne<CanvasShapeCleanupRow>(
        `
          WITH deleted_shapes AS (
            DELETE FROM canvas_freeform_shapes
            WHERE canvas_id = $1
              AND deleted_at IS NOT NULL
            RETURNING id
          )
          SELECT COUNT(*)::int AS deleted_count
          FROM deleted_shapes
        `,
        [canvas.id]
      );

      return {
        ...mapCanvasUserState(userState),
        permanentlyDeletedShapeCount: Number(cleanup?.deleted_count ?? 0)
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

    const canvas = await this.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const values = validateViewSetting(input);
    const updatedCanvas = await this.database.queryOne<CanvasRow>(
      `
        UPDATE canvas
        SET
          zoom = $3,
          viewport_x = $4,
          viewport_y = $5
        WHERE id = $1
          AND workspace_id = $2
          AND board_type = 'freeform'
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

    const shape = await this.database.transaction(async (transaction) => {
      const currentShape = await transaction.queryOne<CanvasShapeRow>(
        `
          SELECT
            s.id,
            s.canvas_id,
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
            AND c.board_type = 'freeform'
            AND s.deleted_at IS NULL
          FOR UPDATE OF s
        `,
        [id, workspaceId]
      );

      if (!currentShape) {
        throw notFound("Canvas shape not found");
      }

      const mergedValues = mergeShapeWriteValues(currentShape, values);
      const contentHash = computeShapeContentHash(mergedValues);

      return transaction.queryOne<CanvasShapeRow>(
        `
          UPDATE canvas_freeform_shapes s
          SET
            shape_type = $3,
            title = $4,
            text_content = $5,
            x = $6,
            y = $7,
            width = $8,
            height = $9,
            rotation = $10,
            z_index = $11,
            raw_shape = $12::jsonb,
            content_hash = $13,
            revision = s.revision + 1
          FROM canvas c
          WHERE s.canvas_id = c.id
            AND s.id = $1
            AND c.workspace_id = $2
            AND c.board_type = 'freeform'
            AND s.deleted_at IS NULL
          RETURNING
            s.id,
            s.canvas_id,
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
        `,
        [
          id,
          workspaceId,
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
    });

    if (!shape) {
      throw notFound("Canvas shape not found");
    }

    return mapShape(shape);
  }

  async deleteShape(
    currentUserId: string,
    workspaceId: string,
    shapeId: string
  ): Promise<CanvasShapeDeletePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const id = validateShapeId(shapeId);
    const shape = await this.database.queryOne<CanvasShapeDeleteRow>(
      `
        UPDATE canvas_freeform_shapes s
        SET
          deleted_at = now(),
          revision = s.revision + 1
        FROM canvas c
        WHERE s.canvas_id = c.id
          AND s.id = $1
          AND c.workspace_id = $2
          AND c.board_type = 'freeform'
          AND s.deleted_at IS NULL
        RETURNING s.id, s.content_hash, s.revision, s.deleted_at
      `,
      [id, workspaceId]
    );

    if (!shape || !shape.deleted_at) {
      throw notFound("Canvas shape not found");
    }

    return mapDeletedShape(shape);
  }

  private async findCanvas(
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasRow | null> {
    if (!UUID_PATTERN.test(canvasId)) {
      return null;
    }

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
          AND c.board_type = 'freeform'
        GROUP BY c.id
      `,
      [canvasId, workspaceId]
    );
  }

}
