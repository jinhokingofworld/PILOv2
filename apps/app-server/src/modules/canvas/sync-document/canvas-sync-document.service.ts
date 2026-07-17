import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import type {
  CanvasRow,
  CanvasSyncDocumentPayload,
  CanvasSyncDocumentRow,
  UpdateCanvasSyncDocumentRequest
} from "../contracts/canvas.types";
import { CanvasAccessService } from "../policies/canvas-access.service";
import { mapCanvasSyncDocument } from "../shape/canvas-shape.mapper";
import { validateCanvasSyncDocumentSnapshot } from "../shape/canvas-shape.validation";

@Injectable()
export class CanvasSyncDocumentService {
  constructor(
    private readonly canvasAccess: CanvasAccessService,
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async getCanvasSyncDocument(
    currentUserId: string,
    workspaceId: string,
    canvasId: string
  ): Promise<CanvasSyncDocumentPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    this.assertTldrawSyncCanvas(canvas);

    const document = await this.database.queryOne<CanvasSyncDocumentRow>(
      `
        SELECT
          canvas_id,
          workspace_id,
          provider_type,
          snapshot,
          version,
          updated_at
        FROM canvas_sync_documents
        WHERE canvas_id = $1
          AND workspace_id = $2
      `,
      [canvas.id, workspaceId]
    );

    return mapCanvasSyncDocument(document, {
      canvasId: canvas.id,
      workspaceId
    });
  }

  async updateCanvasSyncDocument(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: UpdateCanvasSyncDocumentRequest
  ): Promise<CanvasSyncDocumentPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(
      workspaceId,
      canvasId,
      "write"
    );
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    this.assertTldrawSyncCanvas(canvas);

    const snapshot = validateCanvasSyncDocumentSnapshot(input);
    const document = await this.database.queryOne<CanvasSyncDocumentRow>(
      `
        INSERT INTO canvas_sync_documents (
          workspace_id,
          canvas_id,
          provider_type,
          snapshot
        )
        VALUES ($1, $2, 'tldraw_sync', $3)
        ON CONFLICT (canvas_id)
        DO UPDATE SET
          snapshot = EXCLUDED.snapshot,
          version = canvas_sync_documents.version + 1,
          updated_at = now()
        RETURNING
          canvas_id,
          workspace_id,
          provider_type,
          snapshot,
          version,
          updated_at
      `,
      [workspaceId, canvas.id, snapshot]
    );

    if (!document) {
      throw badRequest("Canvas sync document could not be saved");
    }

    return mapCanvasSyncDocument(document, {
      canvasId: canvas.id,
      workspaceId
    });
  }

  private assertTldrawSyncCanvas(canvas: CanvasRow): void {
    if ((canvas.engine_type ?? "classic") !== "tldraw_sync") {
      throw badRequest(
        "Canvas sync document is only available for tldraw_sync canvases"
      );
    }
  }
}
