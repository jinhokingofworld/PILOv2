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
import { BoardIssueAssigneeService } from "./board-issue-assignee.service";
import { BoardReadService } from "./board-read.service";
import { ActiveBoardSourceService } from "./active-board-source.service";
import type { ListBoardIssuesQuery, ListBoardsQuery } from "./dto";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardFilterOptionsPayload,
  BoardIssueCardPayload,
  BoardIssueDetailPayload,
  BoardIssueAssigneeOptionPayload,
  BoardPaginatedPayload,
  BoardPayload,
  BoardRelatedPullRequestPayload,
  CreateBoardResult,
  ActiveBoardSourcePayload
} from "./types";

export interface BoardDeliveryOptionPayload {
  id: string;
  name: string;
  columns: Array<{ id: string; name: string }>;
}

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
    private readonly boardIssueCreateService: BoardIssueCreateService,
    private readonly boardIssueAssigneeService: BoardIssueAssigneeService,
    private readonly activeBoardSourceService: ActiveBoardSourceService
  ) {}

  getModuleInfo(): BoardModuleInfo {
    return {
      domain: "board",
      apiContract: "docs/api/board-api.md"
    };
  }

  async getActiveBoardSource(
    currentUserId: string,
    workspaceId: string
  ): Promise<ActiveBoardSourcePayload | null> {
    return this.activeBoardSourceService.getActiveBoardSource(currentUserId, workspaceId);
  }

  async setActiveBoardSource(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<ActiveBoardSourcePayload> {
    return this.activeBoardSourceService.setActiveBoardSource(currentUserId, workspaceId, body);
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

  async listBoardDeliveryOptions(
    currentUserId: string,
    workspaceId: string
  ): Promise<BoardDeliveryOptionPayload[]> {
    return this.boardReadService.listBoardDeliveryOptions(currentUserId, workspaceId);
  }

  async validateBoardIssueCreateInput(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    body: unknown
  ): Promise<void> {
    await this.boardIssueCreateService.validateBoardIssueCreateInput(
      currentUserId,
      workspaceId,
      boardId,
      body
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

  async listBoardIssueAssigneeOptions(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string
  ): Promise<BoardIssueAssigneeOptionPayload[]> {
    return this.boardIssueAssigneeService.listAssigneeOptions(
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

  /**
   * Internal Agent mutation. The public Board PATCH contract remains a full
   * assignee-list replacement and is intentionally unchanged.
   */
  async updateBoardIssueAssigneesDelta(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    issueId: string,
    input: unknown
  ): Promise<UpdateBoardIssueResult> {
    return this.boardIssueUpdateService.updateBoardIssueAssigneesDelta(
      currentUserId,
      workspaceId,
      boardId,
      issueId,
      input
    );
  }

  async createBoardIssue(
    currentUserId: string,
    workspaceId: string,
    boardId: string,
    body: unknown,
    idempotencyKey: unknown
  ): Promise<CreateBoardIssueResult> {
    return this.boardIssueCreateService.createBoardIssue(
      currentUserId,
      workspaceId,
      boardId,
      body,
      idempotencyKey
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
