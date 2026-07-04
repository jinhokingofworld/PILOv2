import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthGuard } from "./auth.guard";
import { SessionService } from "./session.service";

@Module({
  imports: [DatabaseModule],
  providers: [AuthGuard, SessionService],
  exports: [AuthGuard, SessionService]
})
export class CommonModule {}
