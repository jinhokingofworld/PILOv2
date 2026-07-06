import { Body, Controller, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { BoardService } from "./board.service";
import type { BoardPayload } from "./types";

@Controller("workspaces/:workspaceId/boards")
@UseGuards(AuthGuard)
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

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
}
