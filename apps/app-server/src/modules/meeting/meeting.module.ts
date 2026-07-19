import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { BoardModule } from "../board/board.module";
import { CalendarModule } from "../calendar/calendar.module";
import { ScreenShareModule } from "../screen-share/screen-share.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { LiveKitEgressService } from "./livekit-egress.service";
import { LiveKitTokenService } from "./livekit-token.service";
import { LiveKitWebhookController } from "./livekit-webhook.controller";
import { LiveKitWebhookService } from "./livekit-webhook.service";
import { MeetingController } from "./meeting.controller";
import { CurrentUserMeetingController } from "./current-user-meeting.controller";
import { MeetingReportOutboxPublisherService } from "./meeting-report-outbox-publisher.service";
import { MeetingActionItemExtractionOutboxPublisherService } from "./meeting-action-item-extraction-outbox-publisher.service";
import { MeetingReportOutboxRecoveryService } from "./meeting-report-outbox-recovery.service";
import { MeetingRecordingRetentionService } from "./meeting-recording-retention.service";
import { MeetingReportJobService } from "./meeting-report-job.service";
import { MeetingReportInternalController } from "./meeting-report-internal.controller";
import { MeetingReportEventGuard } from "./meeting-report-event.guard";
import { MeetingReportRealtimePublisherService } from "./meeting-report-realtime-publisher.service";
import { MeetingStateRealtimePublisherService } from "./meeting-state-realtime-publisher.service";
import { MeetingService } from "./meeting.service";
import { MeetingTranscriptRagService } from "./meeting-transcript-rag.service";
import { MeetingActionItemDeliveryService } from "./meeting-action-item-delivery.service";
import { MeetingMembershipRevocationService } from "./meeting-membership-revocation.service";
import {
  CurrentUserMeetingInvitationController,
  MeetingNotificationController
} from "./meeting-notification.controller";
import { MeetingNotificationService } from "./meeting-notification.service";

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    WorkspaceModule,
    CalendarModule,
    BoardModule,
    ScreenShareModule
  ],
  controllers: [
    MeetingController,
    CurrentUserMeetingController,
    MeetingNotificationController,
    CurrentUserMeetingInvitationController,
    LiveKitWebhookController,
    MeetingReportInternalController
  ],
  providers: [
    MeetingService,
    MeetingActionItemDeliveryService,
    MeetingNotificationService,
    MeetingMembershipRevocationService,
    MeetingTranscriptRagService,
    LiveKitEgressService,
    LiveKitTokenService,
    LiveKitWebhookService,
    MeetingReportJobService,
    MeetingReportEventGuard,
    MeetingReportRealtimePublisherService,
    MeetingStateRealtimePublisherService,
    MeetingReportOutboxPublisherService,
    MeetingActionItemExtractionOutboxPublisherService,
    MeetingReportOutboxRecoveryService,
    MeetingRecordingRetentionService
  ],
  exports: [
    MeetingService,
    MeetingTranscriptRagService,
    MeetingActionItemDeliveryService,
    MeetingNotificationService
  ]
})
export class MeetingModule {}
