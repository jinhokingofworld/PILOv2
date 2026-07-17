import { Injectable } from "@nestjs/common";
import { notFound } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import type {
  CanvasShapePayload,
  CanvasShapeRow,
  CanvasShapeSummaryPayload,
  ListCanvasShapesQuery
} from "../contracts/canvas.types";
import {
  CANVAS_READ_ACCESS_SQL,
  CanvasAccessService
} from "../policies/canvas-access.service";
import { mapShape } from "./canvas-shape.mapper";
import {
  validateShapeId,
  validateViewportBounds
} from "./canvas-shape.validation";

@Injectable()
export class CanvasShapeQueryService {
  constructor(
    private readonly canvasAccess: CanvasAccessService,
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listShapesInViewport(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ListCanvasShapesQuery
  ): Promise<CanvasShapeSummaryPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(workspaceId, canvasId);
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
    const maxX =
      (bounds.x ?? 0) + (bounds.width ?? 0) + (bounds.margin ?? 0);
    const maxY =
      (bounds.y ?? 0) + (bounds.height ?? 0) + (bounds.margin ?? 0);
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
}
