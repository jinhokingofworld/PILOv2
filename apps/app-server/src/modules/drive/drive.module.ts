import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { DriveController } from "./drive.controller";
import { DriveService } from "./drive.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [DriveController],
  providers: [DriveService],
  exports: [DriveService]
})
export class DriveModule {}
