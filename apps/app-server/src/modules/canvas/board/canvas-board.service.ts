import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import type {
  CanvasBoardDetailPayload,
  CanvasBoardPayload,
  CanvasRow,
  CanvasViewSettingPayload,
  CreateCanvasRequest,
  UpdateCanvasViewSettingRequest
} from "../contracts/canvas.types";
import { CanvasAccessService, CANVAS_WRITE_ACCESS_SQL } from "../policies/canvas-access.service";
import { mapCanvas } from "../shape/canvas-shape.mapper";
import {
  validateCanvasTitle,
  validateViewSetting
} from "../shape/canvas-shape.validation";

@Injectable()
export class CanvasBoardService {
  constructor(
    private readonly canvasAccess: CanvasAccessService,
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
          AND c.engine_type = 'classic'
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
        INSERT INTO canvas (
          workspace_id,
          title,
          board_type,
          created_by
        )
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

    const canvas = await this.canvasAccess.findCanvas(workspaceId, canvasId);
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

  async updateViewSetting(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: UpdateCanvasViewSettingRequest
  ): Promise<CanvasViewSettingPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(
      workspaceId,
      canvasId,
      "write"
    );
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
}
