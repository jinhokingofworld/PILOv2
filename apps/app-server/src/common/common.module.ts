import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ActivityLogService } from "./activity-log.service";
import { AuthGuard } from "./auth.guard";
import { SessionService } from "./session.service";

@Module({
  imports: [DatabaseModule],
  providers: [ActivityLogService, AuthGuard, SessionService],
  exports: [ActivityLogService, AuthGuard, SessionService]
})
export class CommonModule {}
