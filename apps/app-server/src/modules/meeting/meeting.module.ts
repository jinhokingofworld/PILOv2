import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { MeetingController } from "./meeting.controller";
import { MeetingService } from "./meeting.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [MeetingController],
  providers: [MeetingService],
  exports: [MeetingService]
})
export class MeetingModule {}
