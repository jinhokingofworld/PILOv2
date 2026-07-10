import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { SqlErdService } from "./sql-erd.service";
import {
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  ListSqlErdSessionsQuery,
  SQL_ERD_REQUEST_BODY_LIMIT_BYTES,
  SqlErdDeletedSessionPayload,
  SqlErdSessionListPayload,
  SqlErdSessionPayload,
  UpdateSqlErdSessionRequest
} from "./sql-erd.types";

@Controller("workspaces/:workspaceId")
@UseGuards(AuthGuard)
export class SqlErdSessionController {
  constructor(private readonly sqlErdService: SqlErdService) {}

  @Get("sql-erd-session")
  async getActiveSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<SqlErdSessionPayload | null>> {
    const session = await this.sqlErdService.getActiveSession(
      currentUserId,
      workspaceId
    );

    return apiResponse(session);
  }

  @Get("sql-erd-sessions")
  async listSessions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListSqlErdSessionsQuery
  ): Promise<ApiSuccessResponse<SqlErdSessionListPayload>> {
    const sessions = await this.sqlErdService.listSessions(
      currentUserId,
      workspaceId,
      query
    );

    return apiResponse(sessions);
  }

  @Get("sql-erd-sessions/:sessionId")
  async getSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("sessionId") sessionId: string
  ): Promise<ApiSuccessResponse<SqlErdSessionPayload>> {
    const session = await this.sqlErdService.getSession(
      currentUserId,
      workspaceId,
      sessionId
    );

    return apiResponse(session);
  }

  @RouteConfig({ bodyLimit: SQL_ERD_REQUEST_BODY_LIMIT_BYTES })
  @Post("sql-erd-session")
  async createSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: CreateSqlErdSessionRequest
  ): Promise<ApiSuccessResponse<SqlErdSessionPayload>> {
    const session = await this.sqlErdService.createSession(
      currentUserId,
      workspaceId,
      body
    );

    return apiResponse(session);
  }

  @RouteConfig({ bodyLimit: SQL_ERD_REQUEST_BODY_LIMIT_BYTES })
  @Patch("sql-erd-session/:sessionId")
  async updateSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: UpdateSqlErdSessionRequest
  ): Promise<ApiSuccessResponse<SqlErdSessionPayload>> {
    const session = await this.sqlErdService.updateSession(
      currentUserId,
      workspaceId,
      sessionId,
      body
    );

    return apiResponse(session);
  }

  @Delete("sql-erd-session/:sessionId")
  async deleteSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("sessionId") sessionId: string,
    @Query() query: DeleteSqlErdSessionQuery
  ): Promise<ApiSuccessResponse<SqlErdDeletedSessionPayload>> {
    const result = await this.sqlErdService.deleteSession(
      currentUserId,
      workspaceId,
      sessionId,
      query
    );

    return apiResponse(result);
  }
}
