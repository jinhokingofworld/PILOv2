import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [DatabaseModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService]
})
export class WorkspaceModule {}
