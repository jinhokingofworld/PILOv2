import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import type { CanvasShapeCleanupRow } from "../contracts/canvas.types";

const CANVAS_SHAPE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class CanvasShapeCleanupService
  implements OnModuleDestroy, OnModuleInit
{
  private canvasShapeCleanupInterval: ReturnType<typeof setInterval> | null =
    null;

  constructor(private readonly database: DatabaseService) {}

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
}
