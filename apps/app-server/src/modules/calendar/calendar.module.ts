import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { AuthModule } from "../auth/auth.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarGoogleEventController, GoogleCalendarController } from "./google-calendar.controller";
import { GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarSyncService } from "./google-calendar-sync.service";
import { GoogleCalendarTokenEncryptionService } from "./google-calendar-token-encryption.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule, AuthModule],
  controllers: [CalendarController, GoogleCalendarController, CalendarGoogleEventController],
  providers: [
    CalendarService,
    GoogleCalendarSyncService,
    GoogleCalendarClient,
    GoogleCalendarTokenEncryptionService
  ],
  exports: [CalendarService]
})
export class CalendarModule {}
