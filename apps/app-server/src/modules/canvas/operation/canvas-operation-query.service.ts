import { Injectable } from "@nestjs/common";
import { notFound } from "../../../common/api-error";
import { DatabaseService } from "../../../database/database.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import type {
  CanvasLatestOperationSeqRow,
  CanvasOperationsCatchupPayload,
  CanvasShapeOperationRow,
  ListCanvasOperationsQuery
} from "../contracts/canvas.types";
import {
  CANVAS_READ_ACCESS_SQL,
  CanvasAccessService
} from "../policies/canvas-access.service";
import { mapShapeOperation } from "../shape/canvas-shape.mapper";
import { validateCanvasOperationsAfterSeq } from "../shape/canvas-shape.validation";

@Injectable()
export class CanvasOperationQueryService {
  constructor(
    private readonly canvasAccess: CanvasAccessService,
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listOperationsAfterSeq(
    currentUserId: string,
    workspaceId: string,
    canvasId: string,
    input: ListCanvasOperationsQuery
  ): Promise<CanvasOperationsCatchupPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const canvas = await this.canvasAccess.findCanvas(workspaceId, canvasId);
    if (!canvas) {
      throw notFound("Canvas not found");
    }

    const afterSeq = validateCanvasOperationsAfterSeq(input);
    const latestSeqRow =
      await this.database.queryOne<CanvasLatestOperationSeqRow>(
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
}
