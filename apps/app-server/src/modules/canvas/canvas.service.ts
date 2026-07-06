import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";

interface CanvasRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  title: string;
  board_type: string;
  zoom: number | string;
  viewport_x: number | string;
  viewport_y: number | string;
  shape_count?: number | string;
  updated_at: Date | string;
}

interface CanvasShapeRow extends QueryResultRow {
  id: string;
  canvas_id: string;
  shape_type: string;
  title: string | null;
  text_content: string | null;
  x: number | string;
  y: number | string;
  width: number | string | null;
  height: number | string | null;
  rotation: number | string;
  z_index: number | string;
  raw_shape: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface CanvasShapeDeleteRow extends QueryResultRow {
  id: string;
  deleted_at: Date | string | null;
}

interface CanvasUserStateRow extends QueryResultRow {
  canvas_id: string;
  user_id: string;
  entered_at: Date | string;
  left_at: Date | string | null;
}

interface CanvasShapeCleanupRow extends QueryResultRow {
  deleted_count: number | string;
}

export interface CreateCanvasRequest {
  title?: unknown;
}

export interface CreateCanvasShapeRequest {
  id?: unknown;
  shapeType?: unknown;
  title?: unknown;
  textContent?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  zIndex?: unknown;
  rawShape?: unknown;
}

export type UpdateCanvasShapeRequest = Partial<CreateCanvasShapeRequest>;

export interface UpdateCanvasViewSettingRequest {
  zoom?: unknown;
  viewportX?: unknown;
  viewportY?: unknown;
}

export interface ListCanvasShapesQuery {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  margin?: unknown;
}

export interface SyncCanvasShapesBatchRequest {
  operations?: unknown;
}

export interface CanvasViewSettingPayload {
  zoom: number;
  viewportX: number;
  viewportY: number;
}

export interface CanvasShapePayload {
  id: string;
  canvasId: string;
  shapeType: string;
  title: string | null;
  textContent: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  zIndex: number;
  rawShape: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type CanvasShapeSummaryPayload = CanvasShapePayload;

export interface CanvasBoardPayload {
  id: string;
  workspaceId: string;
  title: string;
  boardType: string;
  zoom: number;
  viewportX: number;
  viewportY: number;
  shapeCount: number;
  updatedAt: string;
}

export interface CanvasBoardDetailPayload extends CanvasBoardPayload {
  shapes: CanvasShapePayload[];
  viewSetting: CanvasViewSettingPayload;
  userState: null;
}

export interface CanvasShapeDeletePayload {
  id: string;
  deleted: true;
  deletedAt: string;
}

export interface CanvasShapeBatchPayload {
  created: number;
  updated: number;
  deleted: number;
}

export interface CanvasUserStatePayload {
  canvasId: string;
  userId: string;
  enteredAt: string;
  leftAt: string | null;
}

export interface CanvasLeavePayload extends CanvasUserStatePayload {
  permanentlyDeletedShapeCount: number;
}

interface ShapeWriteValues {
  shapeType?: string;
  title?: string | null;
  textContent?: string | null;
  x?: number;
  y?: number;
  width?: number | null;
  height?: number | null;
  rotation?: number;
  zIndex?: number;
  rawShape?: Record<string, unknown>;
}

interface ViewportBoundsValues {
  x: number;
  y: number;
  width: number;
  height: number;
  margin: number;
}

type CanvasShapeBatchOperationValues =
  | {
      type: "create";
      shapeId: string;
      payload: CreateCanvasShapeRequest;
    }
  | {
      type: "update";
      shapeId: string;
      payload: UpdateCanvasShapeRequest;
    }
  | {
      type: "delete";
      shapeId: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CANVAS_TITLE_LENGTH = 120;
const MAX_CANVAS_SHAPE_BATCH_OPERATIONS = 100;
const ALLOWED_SHAPE_TYPES = new Set([
  "sticky-note",
  "text",
  "frame",
  "draw",
  "highlight",
  "geo",
  "arrow",
  "line",
  "image",
  "video",
  "bookmark",
  "embed",
  "pilo-sticky-note",
  "pilo-code-block",
  "file_node",
  "group"
]);

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

    return canvases.map((canvas) => this.mapCanvas(canvas));
  }

  async createCanvas(
    currentUserId: string,
    workspaceId: string,
    input: CreateCanvasRequest
  ): Promise<CanvasBoardPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const title = this.validateCanvasTitle(input.title);
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

    return this.mapCanvas(canvas);
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

    const payload = this.mapCanvas(canvas);

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

    const bounds = this.validateViewportBounds(input);
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
          created_at,
          updated_at,
          deleted_at
        FROM canvas_freeform_shapes
        WHERE canvas_id = $1
          AND deleted_at IS NULL
          AND x <= $3
          AND (x + COALESCE(width, 0)) >= $2
          AND y <= $5
          AND (y + COALESCE(height, 0)) >= $4
        ORDER BY z_index ASC, updated_at ASC, id ASC
      `,
      [canvas.id, minX, maxX, minY, maxY]
    );

    return shapes.map((shape) => this.mapShape(shape));
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

    const id = this.validateShapeId(input.id);
    const values = this.validateShapeCreate(input);
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
          NULL
        )
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
        JSON.stringify(values.rawShape ?? {})
      ]
    );

    if (!shape) {
      throw badRequest("Canvas shape could not be created");
    }

    return this.mapShape(shape);
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

    const operations = this.validateShapeBatchOperations(input);

    return this.database.transaction(async (transaction) => {
      const result: CanvasShapeBatchPayload = {
        created: 0,
        updated: 0,
        deleted: 0
      };

      for (const operation of operations) {
        if (operation.type === "create") {
          const values = this.validateShapeCreate(operation.payload);
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
                NULL
              )
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
              JSON.stringify(values.rawShape ?? {})
            ]
          );

          if (!shape) {
            throw badRequest("Canvas shape could not be created");
          }

          result.created += 1;
          continue;
        }

        if (operation.type === "update") {
          const values = this.validateShapeUpdate(operation.payload);
          const updates: string[] = [];
          const queryValues: unknown[] = [operation.shapeId, canvas.id];

          this.addUpdate(updates, queryValues, "shape_type", values.shapeType);
          this.addUpdate(updates, queryValues, "title", values.title);
          this.addUpdate(updates, queryValues, "text_content", values.textContent);
          this.addUpdate(updates, queryValues, "x", values.x);
          this.addUpdate(updates, queryValues, "y", values.y);
          this.addUpdate(updates, queryValues, "width", values.width);
          this.addUpdate(updates, queryValues, "height", values.height);
          this.addUpdate(updates, queryValues, "rotation", values.rotation);
          this.addUpdate(updates, queryValues, "z_index", values.zIndex);
          this.addUpdate(
            updates,
            queryValues,
            "raw_shape",
            values.rawShape === undefined
              ? undefined
              : JSON.stringify(values.rawShape),
            values.rawShape === undefined ? "" : "::jsonb"
          );

          const shape = await transaction.queryOne<CanvasShapeRow>(
            `
              UPDATE canvas_freeform_shapes s
              SET ${updates.join(", ")}
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
                s.created_at,
                s.updated_at,
                s.deleted_at
            `,
            queryValues
          );

          if (!shape) {
            throw notFound("Canvas shape not found");
          }

          result.updated += 1;
          continue;
        }

        const shape = await transaction.queryOne<CanvasShapeDeleteRow>(
          `
            UPDATE canvas_freeform_shapes s
            SET deleted_at = now()
            WHERE s.id = $1
              AND s.canvas_id = $2
              AND s.deleted_at IS NULL
            RETURNING s.id, s.deleted_at
          `,
          [operation.shapeId, canvas.id]
        );

        if (!shape || !shape.deleted_at) {
          throw notFound("Canvas shape not found");
        }

        result.deleted += 1;
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

    const id = this.validateShapeId(shapeId);
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

    return this.mapShape(shape);
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

    return this.mapCanvasUserState(userState);
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
        ...this.mapCanvasUserState(userState),
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

    const values = this.validateViewSetting(input);
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

    const payload = this.mapCanvas(updatedCanvas);

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

    const id = this.validateShapeId(shapeId);
    const values = this.validateShapeUpdate(input);
    const updates: string[] = [];
    const queryValues: unknown[] = [id, workspaceId];

    this.addUpdate(updates, queryValues, "shape_type", values.shapeType);
    this.addUpdate(updates, queryValues, "title", values.title);
    this.addUpdate(updates, queryValues, "text_content", values.textContent);
    this.addUpdate(updates, queryValues, "x", values.x);
    this.addUpdate(updates, queryValues, "y", values.y);
    this.addUpdate(updates, queryValues, "width", values.width);
    this.addUpdate(updates, queryValues, "height", values.height);
    this.addUpdate(updates, queryValues, "rotation", values.rotation);
    this.addUpdate(updates, queryValues, "z_index", values.zIndex);
    this.addUpdate(
      updates,
      queryValues,
      "raw_shape",
      values.rawShape === undefined ? undefined : JSON.stringify(values.rawShape),
      values.rawShape === undefined ? "" : "::jsonb"
    );

    const shape = await this.database.queryOne<CanvasShapeRow>(
      `
        UPDATE canvas_freeform_shapes s
        SET ${updates.join(", ")}
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
          s.created_at,
          s.updated_at,
          s.deleted_at
      `,
      queryValues
    );

    if (!shape) {
      throw notFound("Canvas shape not found");
    }

    return this.mapShape(shape);
  }

  async deleteShape(
    currentUserId: string,
    workspaceId: string,
    shapeId: string
  ): Promise<CanvasShapeDeletePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const id = this.validateShapeId(shapeId);
    const shape = await this.database.queryOne<CanvasShapeDeleteRow>(
      `
        UPDATE canvas_freeform_shapes s
        SET deleted_at = now()
        FROM canvas c
        WHERE s.canvas_id = c.id
          AND s.id = $1
          AND c.workspace_id = $2
          AND c.board_type = 'freeform'
          AND s.deleted_at IS NULL
        RETURNING s.id, s.deleted_at
      `,
      [id, workspaceId]
    );

    if (!shape || !shape.deleted_at) {
      throw notFound("Canvas shape not found");
    }

    return {
      id: shape.id,
      deleted: true,
      deletedAt: this.toIsoString(shape.deleted_at)
    };
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

  private async listActiveShapes(canvasId: string): Promise<CanvasShapePayload[]> {
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
          created_at,
          updated_at,
          deleted_at
        FROM canvas_freeform_shapes
        WHERE canvas_id = $1
          AND deleted_at IS NULL
        ORDER BY z_index ASC, updated_at ASC, id ASC
      `,
      [canvasId]
    );

    return shapes.map((shape) => this.mapShape(shape));
  }

  private validateCanvasTitle(value: unknown): string {
    const title = typeof value === "string" ? value.trim() : "";

    if (title.length > MAX_CANVAS_TITLE_LENGTH) {
      throw badRequest("Canvas title must be 120 characters or less");
    }

    return title || "Untitled canvas";
  }

  private validateShapeId(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest("Canvas shape id is required");
    }

    return value.trim();
  }

  private validateShapeCreate(input: CreateCanvasShapeRequest): Required<ShapeWriteValues> {
    return {
      shapeType: this.validateShapeType(input.shapeType),
      title: this.validateNullableString(input.title, "Shape title"),
      textContent: this.validateNullableString(
        input.textContent,
        "Shape textContent"
      ),
      x: this.validateNumber(input.x, "Shape x", 0),
      y: this.validateNumber(input.y, "Shape y", 0),
      width: this.validateNullableNonNegativeNumber(input.width, "Shape width"),
      height: this.validateNullableNonNegativeNumber(
        input.height,
        "Shape height"
      ),
      rotation: this.validateNumber(input.rotation, "Shape rotation", 0),
      zIndex: this.validateInteger(input.zIndex, "Shape zIndex", 0),
      rawShape: this.validateRawShape(input.rawShape)
    };
  }

  private validateShapeUpdate(input: UpdateCanvasShapeRequest): ShapeWriteValues {
    if (!this.isRecord(input)) {
      throw badRequest("Canvas shape update body is required");
    }

    const values: ShapeWriteValues = {};

    if (this.hasOwn(input, "shapeType")) {
      values.shapeType = this.validateShapeType(input.shapeType);
    }

    if (this.hasOwn(input, "title")) {
      values.title = this.validateNullableString(input.title, "Shape title");
    }

    if (this.hasOwn(input, "textContent")) {
      values.textContent = this.validateNullableString(
        input.textContent,
        "Shape textContent"
      );
    }

    if (this.hasOwn(input, "x")) {
      values.x = this.validateNumber(input.x, "Shape x");
    }

    if (this.hasOwn(input, "y")) {
      values.y = this.validateNumber(input.y, "Shape y");
    }

    if (this.hasOwn(input, "width")) {
      values.width = this.validateNullableNonNegativeNumber(
        input.width,
        "Shape width"
      );
    }

    if (this.hasOwn(input, "height")) {
      values.height = this.validateNullableNonNegativeNumber(
        input.height,
        "Shape height"
      );
    }

    if (this.hasOwn(input, "rotation")) {
      values.rotation = this.validateNumber(input.rotation, "Shape rotation");
    }

    if (this.hasOwn(input, "zIndex")) {
      values.zIndex = this.validateInteger(input.zIndex, "Shape zIndex");
    }

    if (this.hasOwn(input, "rawShape")) {
      values.rawShape = this.validateRawShape(input.rawShape);
    }

    if (Object.keys(values).length === 0) {
      throw badRequest("Canvas shape update body is required");
    }

    return values;
  }

  private validateShapeBatchOperations(
    input: SyncCanvasShapesBatchRequest
  ): CanvasShapeBatchOperationValues[] {
    if (!this.isRecord(input)) {
      throw badRequest("Canvas shape batch body is required");
    }

    if (!Array.isArray(input.operations)) {
      throw badRequest("Canvas shape batch operations must be an array");
    }

    if (input.operations.length > MAX_CANVAS_SHAPE_BATCH_OPERATIONS) {
      throw badRequest(
        `Canvas shape batch operations must be ${MAX_CANVAS_SHAPE_BATCH_OPERATIONS} or fewer`
      );
    }

    return input.operations.map((operation, index) => {
      if (!this.isRecord(operation)) {
        throw badRequest(`Canvas shape batch operation ${index} is invalid`);
      }

      const type = operation.type;
      if (type !== "create" && type !== "update" && type !== "delete") {
        throw badRequest(`Canvas shape batch operation ${index} type is invalid`);
      }

      const shapeId = this.validateShapeId(operation.shapeId);

      if (type === "delete") {
        return {
          type,
          shapeId
        };
      }

      if (!this.isRecord(operation.payload)) {
        throw badRequest(
          `Canvas shape batch operation ${index} payload is required`
        );
      }

      if (type === "create") {
        if (this.hasOwn(operation.payload, "id")) {
          const payloadShapeId = this.validateShapeId(operation.payload.id);
          if (payloadShapeId !== shapeId) {
            throw badRequest(
              `Canvas shape batch operation ${index} shapeId must match payload id`
            );
          }
        }

        return {
          type,
          shapeId,
          payload: {
            ...operation.payload,
            id: shapeId
          }
        };
      }

      return {
        type,
        shapeId,
        payload: operation.payload
      };
    });
  }

  private validateViewSetting(
    input: UpdateCanvasViewSettingRequest
  ): CanvasViewSettingPayload {
    if (!this.isRecord(input)) {
      throw badRequest("Canvas view setting body is required");
    }

    const zoom = this.validateNumber(input.zoom, "Canvas zoom");
    if (zoom <= 0) {
      throw badRequest("Canvas zoom must be greater than 0");
    }

    return {
      zoom,
      viewportX: this.validateNumber(input.viewportX, "Canvas viewportX"),
      viewportY: this.validateNumber(input.viewportY, "Canvas viewportY")
    };
  }

  private validateViewportBounds(input: ListCanvasShapesQuery): ViewportBoundsValues {
    if (!this.isRecord(input)) {
      throw badRequest("Canvas viewport bounds query is required");
    }

    const width = this.validateQueryNumber(input.width, "Canvas viewport width");
    const height = this.validateQueryNumber(input.height, "Canvas viewport height");
    const margin = this.validateQueryNumber(input.margin, "Canvas viewport margin", 0);

    if (width <= 0) {
      throw badRequest("Canvas viewport width must be greater than 0");
    }

    if (height <= 0) {
      throw badRequest("Canvas viewport height must be greater than 0");
    }

    if (margin < 0) {
      throw badRequest("Canvas viewport margin must be greater than or equal to 0");
    }

    return {
      x: this.validateQueryNumber(input.x, "Canvas viewport x"),
      y: this.validateQueryNumber(input.y, "Canvas viewport y"),
      width,
      height,
      margin
    };
  }

  private validateShapeType(value: unknown): string {
    if (typeof value !== "string" || !ALLOWED_SHAPE_TYPES.has(value)) {
      throw badRequest("Canvas shapeType is invalid");
    }

    return value;
  }

  private validateNullableString(value: unknown, fieldName: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw badRequest(`${fieldName} must be a string`);
    }

    return value;
  }

  private validateNumber(
    value: unknown,
    fieldName: string,
    fallback?: number
  ): number {
    if (value === undefined || value === null) {
      if (fallback !== undefined) {
        return fallback;
      }

      throw badRequest(`${fieldName} is required`);
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw badRequest(`${fieldName} must be a finite number`);
    }

    return value;
  }

  private validateQueryNumber(
    value: unknown,
    fieldName: string,
    fallback?: number
  ): number {
    if (value === undefined || value === null || value === "") {
      if (fallback !== undefined) {
        return fallback;
      }

      throw badRequest(`${fieldName} is required`);
    }

    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : NaN;

    if (!Number.isFinite(numberValue)) {
      throw badRequest(`${fieldName} must be a finite number`);
    }

    return numberValue;
  }

  private validateNullableNonNegativeNumber(
    value: unknown,
    fieldName: string
  ): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    const numberValue = this.validateNumber(value, fieldName);
    if (numberValue < 0) {
      throw badRequest(`${fieldName} must be greater than or equal to 0`);
    }

    return numberValue;
  }

  private validateInteger(
    value: unknown,
    fieldName: string,
    fallback?: number
  ): number {
    const numberValue = this.validateNumber(value, fieldName, fallback);

    if (!Number.isInteger(numberValue)) {
      throw badRequest(`${fieldName} must be an integer`);
    }

    return numberValue;
  }

  private validateRawShape(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) {
      return {};
    }

    if (!this.isRecord(value)) {
      throw badRequest("Shape rawShape must be an object");
    }

    return value;
  }

  private addUpdate(
    updates: string[],
    values: unknown[],
    column: string,
    value: unknown,
    cast = ""
  ): void {
    if (value === undefined) {
      return;
    }

    values.push(value);
    updates.push(`${column} = $${values.length}${cast}`);
  }

  private mapCanvas(canvas: CanvasRow, shapeCount?: number): CanvasBoardPayload {
    const zoom = this.toNumber(canvas.zoom);
    const viewportX = this.toNumber(canvas.viewport_x);
    const viewportY = this.toNumber(canvas.viewport_y);

    return {
      id: canvas.id,
      workspaceId: canvas.workspace_id,
      title: canvas.title,
      boardType: canvas.board_type,
      zoom,
      viewportX,
      viewportY,
      shapeCount:
        shapeCount ?? (canvas.shape_count === undefined ? 0 : Number(canvas.shape_count)),
      updatedAt: this.toIsoString(canvas.updated_at)
    };
  }

  private mapShape(shape: CanvasShapeRow): CanvasShapePayload {
    return {
      id: shape.id,
      canvasId: shape.canvas_id,
      shapeType: shape.shape_type,
      title: shape.title,
      textContent: shape.text_content,
      x: this.toNumber(shape.x),
      y: this.toNumber(shape.y),
      width: shape.width === null ? null : this.toNumber(shape.width),
      height: shape.height === null ? null : this.toNumber(shape.height),
      rotation: this.toNumber(shape.rotation),
      zIndex: Number(shape.z_index),
      rawShape: shape.raw_shape ?? {},
      createdAt: this.toIsoString(shape.created_at),
      updatedAt: this.toIsoString(shape.updated_at),
      deletedAt:
        shape.deleted_at === null ? null : this.toIsoString(shape.deleted_at)
    };
  }

  private mapCanvasUserState(
    userState: CanvasUserStateRow
  ): CanvasUserStatePayload {
    return {
      canvasId: userState.canvas_id,
      userId: userState.user_id,
      enteredAt: this.toIsoString(userState.entered_at),
      leftAt:
        userState.left_at === null ? null : this.toIsoString(userState.left_at)
    };
  }

  private toNumber(value: number | string): number {
    return typeof value === "number" ? value : Number(value);
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
  }
}
