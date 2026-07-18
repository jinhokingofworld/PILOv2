import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { ScreenShareService } from "./screen-share.service";

@Controller("workspaces/:workspaceId/screen-share-sessions")
@UseGuards(AuthGuard)
export class ScreenShareController {
  constructor(private readonly service: ScreenShareService) {}

  @Get("current")
  async getCurrent(
    @CurrentUserId() userId: string,
    @Param("workspaceId") workspaceId: string
  ) {
    return apiResponse(await this.service.getCurrent(userId, workspaceId));
  }

  @Post()
  async start(
    @CurrentUserId() userId: string,
    @Param("workspaceId") workspaceId: string,
    @Res({ passthrough: true }) response: FastifyReply
  ) {
    const payload = await this.service.start(userId, workspaceId);
    response.status(this.service.getStartHttpStatus(payload));
    return apiResponse(payload);
  }

  @Post(":sessionId/viewer-token")
  @HttpCode(HttpStatus.OK)
  async viewerToken(
    @CurrentUserId() userId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("sessionId") sessionId: string
  ) {
    return apiResponse(
      await this.service.createViewerToken(userId, workspaceId, sessionId)
    );
  }

  @Delete(":sessionId")
  async end(
    @CurrentUserId() userId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("sessionId") sessionId: string
  ) {
    return apiResponse(await this.service.end(userId, workspaceId, sessionId));
  }
}
