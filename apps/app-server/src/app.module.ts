import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { CanvasModule } from "./modules/canvas/canvas.module";
import { GithubIntegrationModule } from "./modules/github-integration/github-integration.module";
import { MeetingModule } from "./modules/meeting/meeting.module";
import { DatabaseModule } from "./database/database.module";
import { UserModule } from "./modules/user/user.module";
import { WorkspaceModule } from "./modules/workspace/workspace.module";

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    WorkspaceModule,
    GithubIntegrationModule,
    MeetingModule,
    CalendarModule,
    CanvasModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
