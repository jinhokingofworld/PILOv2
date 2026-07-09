import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { CalendarModule } from "../calendar/calendar.module";
import { MeetingModule } from "../meeting/meeting.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { AgentConfirmationService } from "./agent-confirmation.service";
import { AgentController } from "./agent.controller";
import { AgentJobService } from "./agent-job.service";
import { AgentLoggingService } from "./agent-logging.service";
import { AgentPlannerService } from "./agent-planner.service";
import { AgentService } from "./agent.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import { CalendarAgentToolsService } from "./tools/calendar-agent-tools.service";
import { MeetingAgentToolsService } from "./tools/meeting-agent-tools.service";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    WorkspaceModule,
    CalendarModule,
    MeetingModule
  ],
  controllers: [AgentController],
  providers: [
    AgentService,
    AgentConfirmationService,
    AgentJobService,
    AgentLoggingService,
    AgentPlannerService,
    AgentToolRegistryService,
    CalendarAgentToolsService,
    MeetingAgentToolsService
  ]
})
export class AgentModule {}
