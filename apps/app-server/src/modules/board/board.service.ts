import { Injectable } from "@nestjs/common";
import { BoardHydrationService } from "./board-hydration.service";
import { BoardReadService } from "./board-read.service";
import type { ListBoardIssuesQuery, ListBoardsQuery } from "./dto";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardIssueCardPayload,
  BoardPaginatedPayload,
  BoardPayload,
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
    private readonly boardReadService: BoardReadService
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
}
