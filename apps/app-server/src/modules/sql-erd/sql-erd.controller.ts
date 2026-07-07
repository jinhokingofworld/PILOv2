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
  SQL_ERD_REQUEST_BODY_LIMIT_BYTES,
  SqlErdDeletedSessionPayload,
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
