import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import type {
  CanvasLeavePayload,
  CanvasUserStatePayload,
  CanvasUserStateRow
} from "../contracts/canvas.types";
import { CanvasAccessService } from "../policies/canvas-access.service";
import { mapCanvasUserState } from "../shape/canvas-shape.mapper";

@Injectable()
export class CanvasUserStateService {
  constructor(
    private readonly canvasAccess: CanvasAccessService,
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async enterCanvas(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasUserStatePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(workspaceId, canvasId);
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

    const canvas = await this.canvasAccess.findCanvas(workspaceId, canvasId);
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
}
