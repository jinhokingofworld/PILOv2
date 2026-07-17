import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { BoardModule } from "../board/board.module";
import { CalendarModule } from "../calendar/calendar.module";
import { DriveModule } from "../drive/drive.module";
import { MeetingModule } from "../meeting/meeting.module";
import { PrReviewModule } from "../pr-review/pr-review.module";
import { SqlErdModule } from "../sql-erd/sql-erd.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { CanvasAgentModule } from "../canvas/agent/canvas-agent.module";
import { AgentCanvasDelegationCompletionService } from "./agent-canvas-delegation-completion.service";
import { AgentCandidateSelectionService } from "./agent-candidate-selection.service";
import { AgentConfirmationService } from "./agent-confirmation.service";
import { AgentController } from "./agent.controller";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentExecutionHandoffGuard } from "./agent-execution-handoff.guard";
import { AgentInternalController } from "./agent-internal.controller";
import { AgentJobService } from "./agent-job.service";
import { AgentLoggingService } from "./agent-logging.service";
import { AgentOutboxPublisherService } from "./agent-outbox-publisher.service";
import { AgentGroundedAnswerService } from "./agent-grounded-answer.service";
import { AgentGroundedAnswerOutboxPublisherService } from "./agent-grounded-answer-outbox-publisher.service";
import { AgentPlannerService } from "./agent-planner.service";
import { AgentService } from "./agent.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import { BoardAgentToolsService } from "./tools/board-agent-tools.service";
import { BoardContextResolverService } from "./tools/board-context-resolver.service";
import { CalendarAgentToolsService } from "./tools/calendar-agent-tools.service";
import { MeetingAgentResourceResolver } from "./tools/meeting-agent-resource-resolver.service";
import { MeetingAgentToolsService } from "./tools/meeting-agent-tools.service";
import { SqlErdAgentToolsService } from "./tools/sql-erd-agent-tools.service";
import { PrReviewAgentToolsService } from "./tools/pr-review-agent-tools.service";
import { CanvasAgentDelegationToolsService } from "./tools/canvas-agent-delegation-tools.service";
import { DriveAgentToolsService } from "./tools/drive-agent-tools.service";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    WorkspaceModule,
    CalendarModule,
    DriveModule,
    MeetingModule,
    BoardModule,
    SqlErdModule,
    PrReviewModule,
    CanvasAgentModule
  ],
  controllers: [AgentController, AgentInternalController],
  providers: [
    AgentService,
    AgentCandidateSelectionService,
    AgentConfirmationService,
    AgentExecutionService,
    AgentExecutionHandoffGuard,
    AgentJobService,
    AgentLoggingService,
    AgentOutboxPublisherService,
    AgentGroundedAnswerService,
    AgentGroundedAnswerOutboxPublisherService,
    AgentPlannerService,
    AgentToolRegistryService,
    AgentCanvasDelegationCompletionService,
    BoardContextResolverService,
    BoardAgentToolsService,
    CalendarAgentToolsService,
    MeetingAgentResourceResolver,
    MeetingAgentToolsService,
    DriveAgentToolsService,
    CanvasAgentDelegationToolsService,
    SqlErdAgentToolsService,
    PrReviewAgentToolsService
  ]
})
export class AgentModule {}
