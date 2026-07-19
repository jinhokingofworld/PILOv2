import { forwardRef, Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { CanvasAgentModule } from "./agent/canvas-agent.module";
import { CanvasBoardService } from "./board/canvas-board.service";
import { CanvasController } from "./canvas.controller";
import { CanvasShapeCleanupService } from "./infrastructure/canvas-shape-cleanup.service";
import { CanvasOperationPublisherService } from "./operation/canvas-operation-publisher.service";
import { CanvasOperationQueryService } from "./operation/canvas-operation-query.service";
import { CanvasAccessService } from "./policies/canvas-access.service";
import { CanvasService } from "./canvas.service";
import { CanvasShapeCommandService } from "./shape/canvas-shape-command.service";
import { CanvasShapeQueryService } from "./shape/canvas-shape-query.service";
import { CanvasUserStateService } from "./user-state/canvas-user-state.service";
import { CanvasRecordingActivityController } from "./recording-activity/canvas-recording-activity.controller";
import { CanvasRecordingActivityGuard } from "./recording-activity/canvas-recording-activity.guard";
import { CanvasRecordingActivityService } from "./recording-activity/canvas-recording-activity.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule, forwardRef(() => CanvasAgentModule)],
  controllers: [CanvasController, CanvasRecordingActivityController],
  providers: [
    CanvasAccessService,
    CanvasBoardService,
    CanvasOperationPublisherService,
    CanvasOperationQueryService,
    CanvasService,
    CanvasShapeCleanupService,
    CanvasShapeCommandService,
    CanvasShapeQueryService,
    CanvasUserStateService,
    CanvasRecordingActivityGuard,
    CanvasRecordingActivityService
  ],
  exports: [CanvasService]
})
export class CanvasModule {}
