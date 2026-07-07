import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [AgentController],
  providers: [AgentService]
})
export class AgentModule {}
