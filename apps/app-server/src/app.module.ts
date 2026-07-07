import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { BoardModule } from "./modules/board/board.module";
import { CalendarModule } from "./modules/calendar/calendar.module";
import { CanvasModule } from "./modules/canvas/canvas.module";
import { GithubIntegrationModule } from "./modules/github-integration/github-integration.module";
import { AuthModule } from "./modules/auth/auth.module";
import { MeetingModule } from "./modules/meeting/meeting.module";
import { PrReviewModule } from "./modules/pr-review/pr-review.module";
import { SqlErdModule } from "./modules/sql-erd/sql-erd.module";
import { DatabaseModule } from "./database/database.module";
import { UserModule } from "./modules/user/user.module";
import { WorkspaceModule } from "./modules/workspace/workspace.module";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    UserModule,
    WorkspaceModule,
    GithubIntegrationModule,
    PrReviewModule,
    BoardModule,
    MeetingModule,
    CalendarModule,
    CanvasModule,
    SqlErdModule
  ],
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
