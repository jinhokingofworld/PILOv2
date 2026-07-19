import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import type { CanvasRow } from "../contracts/canvas.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CANVAS_READ_ACCESS_SQL = `
  (
    (
      c.board_type = 'freeform'
      AND c.engine_type = 'classic'
    )
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

export const CANVAS_WRITE_ACCESS_SQL = `
  (
    (
      c.board_type = 'freeform'
      AND c.engine_type = 'classic'
    )
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

export type CanvasAccessMode = "read" | "write";

@Injectable()
export class CanvasAccessService {
  constructor(private readonly database: DatabaseService) {}

  async findCanvas(
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
