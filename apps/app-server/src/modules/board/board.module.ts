import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { BoardController } from "./board.controller";
import { BoardHydrationService } from "./board-hydration.service";
import { BoardService } from "./board.service";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [BoardController],
  providers: [BoardService, BoardHydrationService],
  exports: [BoardService]
})
export class BoardModule {}
