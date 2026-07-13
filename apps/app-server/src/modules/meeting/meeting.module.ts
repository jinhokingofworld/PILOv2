import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { LiveKitEgressService } from "./livekit-egress.service";
import { LiveKitTokenService } from "./livekit-token.service";
import { LiveKitWebhookController } from "./livekit-webhook.controller";
import { LiveKitWebhookService } from "./livekit-webhook.service";
import { MeetingController } from "./meeting.controller";
import { MeetingReportOutboxPublisherService } from "./meeting-report-outbox-publisher.service";
import { MeetingReportOutboxRecoveryService } from "./meeting-report-outbox-recovery.service";
import { MeetingReportJobService } from "./meeting-report-job.service";
import { MeetingReportInternalController } from "./meeting-report-internal.controller";
import { MeetingReportEventGuard } from "./meeting-report-event.guard";
import { MeetingReportRealtimePublisherService } from "./meeting-report-realtime-publisher.service";
import { MeetingStateRealtimePublisherService } from "./meeting-state-realtime-publisher.service";
import { MeetingService } from "./meeting.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [MeetingController, LiveKitWebhookController, MeetingReportInternalController],
  providers: [
    MeetingService,
    LiveKitEgressService,
    LiveKitTokenService,
    LiveKitWebhookService,
    MeetingReportJobService,
    MeetingReportEventGuard,
    MeetingReportRealtimePublisherService,
    MeetingStateRealtimePublisherService,
    MeetingReportOutboxPublisherService,
    MeetingReportOutboxRecoveryService
  ],
  exports: [MeetingService]
})
export class MeetingModule {}
