import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [CommonModule, DatabaseModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService]
})
export class SettingsModule {}
