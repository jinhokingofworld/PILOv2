import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { AgentController } from "./agent.controller";
import { AgentPlannerService } from "./agent-planner.service";
import { AgentService } from "./agent.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [AgentController],
  providers: [AgentService, AgentPlannerService, AgentToolRegistryService]
})
export class AgentModule {}
