import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { ScreenShareController } from "./screen-share.controller";
import { ScreenShareCleanupService } from "./screen-share-cleanup.service";
import { ScreenShareMembershipRevocationService } from "./screen-share-membership-revocation.service";
import { ScreenShareRealtimePublisherService } from "./screen-share-realtime-publisher.service";
import { ScreenShareRoomService } from "./screen-share-room.service";
import { ScreenShareService } from "./screen-share.service";
import { ScreenShareStateService } from "./screen-share-state.service";
import { ScreenShareTokenService } from "./screen-share-token.service";
import { ScreenShareWebhookService } from "./screen-share-webhook.service";

@Module({
  imports: [CommonModule, WorkspaceModule],
  controllers: [ScreenShareController],
  providers: [
    ScreenShareService,
    ScreenShareCleanupService,
    ScreenShareStateService,
    ScreenShareTokenService,
    ScreenShareRoomService,
    ScreenShareRealtimePublisherService,
    ScreenShareWebhookService,
    ScreenShareMembershipRevocationService
  ],
  exports: [ScreenShareService, ScreenShareRoomService, ScreenShareWebhookService]
})
export class ScreenShareModule {}
