import { Injectable } from "@nestjs/common";
import { BoardHydrationService } from "./board-hydration.service";
import { BoardIssueReadService } from "./board-issue-read.service";
import {
  BoardIssueStatusService,
  type UpdateBoardIssueStatusResult
} from "./board-issue-status.service";
import {
  BoardIssueUpdateService,
  type UpdateBoardIssueResult
} from "./board-issue-update.service";
import {
  BoardIssueCreateService,
  type CreateBoardIssueResult
} from "./board-issue-create.service";
import { BoardReadService } from "./board-read.service";
import type { ListBoardIssuesQuery, ListBoardsQuery } from "./dto";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardFilterOptionsPayload,
  BoardIssueCardPayload,
  BoardIssueDetailPayload,
  BoardPaginatedPayload,
  BoardPayload,
  BoardRelatedPullRequestPayload,
  CreateBoardResult
} from "./types";

export interface BoardModuleInfo {
  domain: "board";
  apiContract: "docs/api/board-api.md";
}

@Injectable()
export class BoardService {
  constructor(
    private readonly boardHydrationService: BoardHydrationService,
    private readonly boardReadService: BoardReadService,
    private readonly boardIssueReadService: BoardIssueReadService,
    private readonly boardIssueStatusService: BoardIssueStatusService,
    private readonly boardIssueUpdateService: BoardIssueUpdateService,
    private readonly boardIssueCreateService: BoardIssueCreateService
  ) {}

  getModuleInfo(): BoardModuleInfo {
    return {
      domain: "board",
      apiContract: "docs/api/board-api.md"
    };
  }

  async createBoard(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<CreateBoardResult> {
    return this.boardHydrationService.createBoard(currentUserId, workspaceId, body);
  }

  async listBoards(
    currentUserId: string,
    workspaceId: string,
    query: ListBoardsQuery
  ): Promise<BoardPaginatedPayload<BoardPayload>> {
    return this.boardReadService.listBoards(currentUserId, workspaceId, query);
  }

  async getBoard(
    currentUserId: string,
    workspaceId: string,
    boardId: string
  ): Promise<BoardDetailPayload> {
    return this.boardReadService.getBoard(currentUserId, workspaceId, boardId);
  }

  async listBoardColumns(
    currentUserId: string,
    workspaceId: string,
    boardId: string
  ): Promise<BoardColumnPayload[]> {
    return this.boardReadService.listBoardColumns(
      currentUserId,
      workspaceId,
      boardId
    );
  }

  async listBoardIssues(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    query: ListBoardIssuesQuery
  ): Promise<BoardPaginatedPayload<BoardIssueCardPayload>> {
    return this.boardReadService.listBoardIssues(
      currentUserId,
      workspaceId,
      boardId,
      query
    );
  }

  async getBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueDetailPayload> {
    return this.boardIssueReadService.getBoardIssue(
      currentUserId,
      workspaceId,
      boardId,
      issueId
    );
  }

  async updateBoardIssueStatus(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string,
    body: unknown
  ): Promise<UpdateBoardIssueStatusResult> {
    return this.boardIssueStatusService.updateBoardIssueStatus(
      currentUserId,
      workspaceId,
      boardId,
      issueId,
      body
    );
  }

  async updateBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string,
    body: unknown
  ): Promise<UpdateBoardIssueResult> {
    return this.boardIssueUpdateService.updateBoardIssue(
      currentUserId,
      workspaceId,
      boardId,
      issueId,
      body
    );
  }

  async createBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    body: unknown
  ): Promise<CreateBoardIssueResult> {
    return this.boardIssueCreateService.createBoardIssue(
      currentUserId,
      workspaceId,
      boardId,
      body
    );
  }

  async listBoardIssuePullRequests(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardRelatedPullRequestPayload[]> {
    return this.boardIssueReadService.listBoardIssuePullRequests(
      currentUserId,
      workspaceId,
      boardId,
      issueId
    );
  }

  async getBoardFilterOptions(
    currentUserId: string,
    workspaceId: string,
    boardId: string
  ): Promise<BoardFilterOptionsPayload> {
    return this.boardIssueReadService.getBoardFilterOptions(
      currentUserId,
      workspaceId,
      boardId
    );
  }
}
