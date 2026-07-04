import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [CommonModule, DatabaseModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService]
})
export class WorkspaceModule {}
