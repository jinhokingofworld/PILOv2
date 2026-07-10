import { forwardRef, Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { CanvasAgentModule } from "./agent/canvas-agent.module";
import { CanvasController } from "./canvas.controller";
import { CanvasOperationPublisherService } from "./canvas-operation-publisher.service";
import { CanvasService } from "./canvas.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule, forwardRef(() => CanvasAgentModule)],
  controllers: [CanvasController],
  providers: [CanvasOperationPublisherService, CanvasService],
  exports: [CanvasService]
})
export class CanvasModule {}
