import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { BoardModule } from "../board/board.module";
import { CalendarModule } from "../calendar/calendar.module";
import { MeetingModule } from "../meeting/meeting.module";
import { SqlErdModule } from "../sql-erd/sql-erd.module";
import { WorkspaceModule } from "../workspace/workspace.module";
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
import { MeetingAgentToolsService } from "./tools/meeting-agent-tools.service";
import { SqlErdAgentToolsService } from "./tools/sql-erd-agent-tools.service";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    WorkspaceModule,
    CalendarModule,
    MeetingModule,
    BoardModule,
    SqlErdModule
  ],
  controllers: [AgentController, AgentInternalController],
  providers: [
    AgentService,
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
    BoardContextResolverService,
    BoardAgentToolsService,
    CalendarAgentToolsService,
    MeetingAgentToolsService,
    SqlErdAgentToolsService
  ]
})
export class AgentModule {}
