import type { FastifyReply } from "fastify";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards
} from "@nestjs/common";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { ChatService } from "./chat.service";
import type {
  ChatMentionNotification,
  ChatMentionPage,
  ChatMessageContext,
  ChatMessagePage,
  ChatReadStatePayload,
  ChatSummaryPayload,
  WorkspaceChatMessage
} from "./chat-types";

@Controller("workspaces/:workspaceId/chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get("summary")
  async getSummary(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<ChatSummaryPayload>> {
    return apiResponse(
      await this.chatService.getSummary(currentUserId, workspaceId)
    );
  }

  @Get("messages")
  async listMessages(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: unknown
  ): Promise<ApiSuccessResponse<ChatMessagePage>> {
    return apiResponse(
      await this.chatService.listMessages(currentUserId, workspaceId, query)
    );
  }

  @Get("messages/:messageId/context")
  async getMessageContext(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("messageId") messageId: string
  ): Promise<ApiSuccessResponse<ChatMessageContext>> {
    return apiResponse(
      await this.chatService.getMessageContext(
        currentUserId,
        workspaceId,
        messageId
      )
    );
  }

  @Post("messages")
  async createMessage(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<WorkspaceChatMessage>> {
    const result = await this.chatService.createMessage(
      currentUserId,
      workspaceId,
      body
    );
    reply.status(result.replayed ? 200 : 201);
    return apiResponse(result.message);
  }

  @Delete("messages/:messageId")
  async deleteMessage(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("messageId") messageId: string
  ): Promise<ApiSuccessResponse<WorkspaceChatMessage>> {
    return apiResponse(
      await this.chatService.deleteMessage(
        currentUserId,
        workspaceId,
        messageId
      )
    );
  }

  @Put("read-state")
  async updateReadState(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<ChatReadStatePayload>> {
    return apiResponse(
      await this.chatService.updateReadState(currentUserId, workspaceId, body)
    );
  }

  @Get("mentions")
  async listMentions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: unknown
  ): Promise<ApiSuccessResponse<ChatMentionPage>> {
    return apiResponse(
      await this.chatService.listMentions(currentUserId, workspaceId, query)
    );
  }

  @Put("mentions/:mentionId/read")
  async readMention(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("mentionId") mentionId: string
  ): Promise<ApiSuccessResponse<ChatMentionNotification>> {
    return apiResponse(
      await this.chatService.readMention(
        currentUserId,
        workspaceId,
        mentionId
      )
    );
  }
}
