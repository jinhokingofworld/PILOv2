import { forwardRef, Module } from "@nestjs/common";
import { CommonModule } from "../../../common/common.module";
import { DatabaseModule } from "../../../database/database.module";
import { WorkspaceModule } from "../../workspace/workspace.module";
import { CanvasModule } from "../canvas.module";
import { CanvasAgentActionService } from "./canvas-agent-action.service";
import { CanvasAgentDraftService } from "./canvas-agent-draft.service";
import { CanvasAgentJobService } from "./canvas-agent-job.service";
import { CanvasAgentRepository } from "./canvas-agent.repository";
import { CanvasAgentService } from "./canvas-agent.service";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    WorkspaceModule,
    forwardRef(() => CanvasModule)
  ],
  providers: [
    CanvasAgentActionService,
    CanvasAgentDraftService,
    CanvasAgentJobService,
    CanvasAgentRepository,
    CanvasAgentService
  ],
  exports: [CanvasAgentService]
})
export class CanvasAgentModule {}
