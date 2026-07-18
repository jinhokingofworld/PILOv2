import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { ScreenShareController } from "./screen-share.controller";
import { ScreenShareRealtimePublisherService } from "./screen-share-realtime-publisher.service";
import { ScreenShareRoomService } from "./screen-share-room.service";
import { ScreenShareService } from "./screen-share.service";
import { ScreenShareStateService } from "./screen-share-state.service";
import { ScreenShareTokenService } from "./screen-share-token.service";

@Module({
  imports: [CommonModule, WorkspaceModule],
  controllers: [ScreenShareController],
  providers: [
    ScreenShareService,
    ScreenShareStateService,
    ScreenShareTokenService,
    ScreenShareRoomService,
    ScreenShareRealtimePublisherService
  ],
  exports: [ScreenShareService, ScreenShareRoomService]
})
export class ScreenShareModule {}
