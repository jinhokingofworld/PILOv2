import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { BoardController } from "./board.controller";
import { BoardHydrationService } from "./board-hydration.service";
import { BoardReadService } from "./board-read.service";
import { BoardService } from "./board.service";
import { BoardReadQueries } from "./queries/board-read.queries";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule],
  controllers: [BoardController],
  providers: [
    BoardService,
    BoardHydrationService,
    BoardReadService,
    BoardReadQueries
  ],
  exports: [BoardService]
})
export class BoardModule {}
