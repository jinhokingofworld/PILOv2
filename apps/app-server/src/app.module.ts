import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AgentModule } from "./modules/agent/agent.module";
import { BoardModule } from "./modules/board/board.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { ChatModule } from "./modules/chat/chat.module";
import { CanvasModule } from "./modules/canvas/canvas.module";
import { DriveModule } from "./modules/drive/drive.module";
import { GithubIntegrationModule } from "./modules/github-integration/github-integration.module";
import { AuthModule } from "./modules/auth/auth.module";
import { MeetingModule } from "./modules/meeting/meeting.module";
import { PrReviewModule } from "./modules/pr-review/pr-review.module";
import { SqlErdModule } from "./modules/sql-erd/sql-erd.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { ScreenShareModule } from "./modules/screen-share/screen-share.module";
import { DatabaseModule } from "./database/database.module";
import { UserModule } from "./modules/user/user.module";
import { WorkspaceModule } from "./modules/workspace/workspace.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UserModule,
    SettingsModule,
    WorkspaceModule,
    ScreenShareModule,
    AgentModule,
    GithubIntegrationModule,
    PrReviewModule,
    BoardModule,
    MeetingModule,
    CalendarModule,
    ChatModule,
    CanvasModule,
    DriveModule,
    SqlErdModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
