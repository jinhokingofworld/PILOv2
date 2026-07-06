import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { BoardService } from "./board.service";
import type { ListBoardIssuesQuery, ListBoardsQuery } from "./dto";
import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardIssueCardPayload,
  BoardPaginatedPayload,
  BoardPayload
} from "./types";

@Controller("workspaces/:workspaceId/boards")
@UseGuards(AuthGuard)
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Get()
  async listBoards(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListBoardsQuery
  ): Promise<ApiSuccessResponse<BoardPaginatedPayload<BoardPayload>>> {
    const boards = await this.boardService.listBoards(
      currentUserId,
      workspaceId,
      query
    );

    return apiResponse(boards);
  }

  @Post()
  async createBoard(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<BoardPayload>> {
    const result = await this.boardService.createBoard(
      currentUserId,
      workspaceId,
      body
    );
    reply.status(result.statusCode);
    return apiResponse(result.board);
  }

  @Get(":boardId")
  async getBoard(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("boardId") boardId: string
  ): Promise<ApiSuccessResponse<BoardDetailPayload>> {
    const board = await this.boardService.getBoard(
      currentUserId,
      workspaceId,
      boardId
    );

    return apiResponse(board);
  }

  @Get(":boardId/columns")
  async listBoardColumns(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("boardId") boardId: string
  ): Promise<ApiSuccessResponse<BoardColumnPayload[]>> {
    const columns = await this.boardService.listBoardColumns(
      currentUserId,
      workspaceId,
      boardId
    );

    return apiResponse(columns);
  }

  @Get(":boardId/issues")
  async listBoardIssues(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("boardId") boardId: string,
    @Query() query: ListBoardIssuesQuery
  ): Promise<ApiSuccessResponse<BoardPaginatedPayload<BoardIssueCardPayload>>> {
    const issues = await this.boardService.listBoardIssues(
      currentUserId,
      workspaceId,
      boardId,
      query
    );

    return apiResponse(issues);
  }
}
