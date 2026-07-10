import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { DatabaseModule } from "../../database/database.module";
import { GithubIntegrationModule } from "../github-integration/github-integration.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { BoardController } from "./board.controller";
import { BoardHydrationService } from "./board-hydration.service";
import { BoardIssueCreateService } from "./board-issue-create.service";
import { BoardIssueCreateOperationService } from "./board-issue-create-operation.service";
import { BoardIssueReadService } from "./board-issue-read.service";
import { BoardIssueStatusService } from "./board-issue-status.service";
import { BoardIssueUpdateService } from "./board-issue-update.service";
import { BoardReadService } from "./board-read.service";
import { BoardService } from "./board.service";
import { BoardIssueStatusQueries } from "./queries/board-issue-status.queries";
import { BoardIssueUpdateQueries } from "./queries/board-issue-update.queries";
import { BoardIssueCreateQueries } from "./queries/board-issue-create.queries";
import { BoardIssueCreateOperationQueries } from "./queries/board-issue-create-operation.queries";
import { BoardReadQueries } from "./queries/board-read.queries";

@Module({
  imports: [CommonModule, DatabaseModule, WorkspaceModule, GithubIntegrationModule],
  controllers: [BoardController],
  providers: [
    BoardService,
    BoardHydrationService,
    BoardIssueCreateOperationService,
    BoardIssueCreateService,
    BoardIssueReadService,
    BoardIssueStatusService,
    BoardIssueUpdateService,
    BoardReadService,
    BoardIssueCreateQueries,
    BoardIssueCreateOperationQueries,
    BoardIssueStatusQueries,
    BoardIssueUpdateQueries,
    BoardReadQueries
  ],
  exports: [BoardService]
})
export class BoardModule {}
