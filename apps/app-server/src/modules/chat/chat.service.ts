import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import { badRequest, forbidden, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  insertChatMentions,
  insertChatMessage,
  lockChatIdempotencyKey,
  markChatMentionRead,
  selectChatContextTarget,
  selectChatMentionTargets,
  selectChatMentions,
  selectChatMessageByClientId,
  selectChatMessageById,
  selectChatMessageContext,
  selectChatMessageForUpdate,
  selectChatMessages,
  selectChatSummary,
  softDeleteChatMessage,
  upsertChatReadState
} from "./chat-queries";
import { computeChatRequestFingerprint } from "./chat-idempotency";
import { ChatPublisherService } from "./chat-publisher.service";
import type {
  ChatCursor,
  ChatMentionNotification,
  ChatMentionPage,
  ChatMentionRow,
  ChatMessageContext,
  ChatMessagePage,
  ChatMessageRow,
  ChatReadStatePayload,
  ChatRedisEventV1,
  ChatSummaryPayload,
  WorkspaceChatMessage
} from "./chat-types";
import {
  decodeChatCursor,
  encodeChatCursor,
  readChatLimit,
  readChatUuid,
  readCreateChatMessageBody,
  readLastReadBody,
  readOptionalChatCursor
} from "./chat-validation";

type ChatPageInput = {
  before: ChatCursor | null;
  limit: number;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly publisher: ChatPublisherService
  ) {}

  async getSummary(
    currentUserId: string,
    workspaceId: string
  ): Promise<ChatSummaryPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const row = await selectChatSummary(
      this.database,
      workspaceId,
      currentUserId
    );
    if (!row) {
      throw notFound("Chat summary not found");
    }

    return {
      latestMessageId: row.latest_message_id,
      lastReadMessageId: row.last_read_message_id,
      unreadCount: Number(row.unread_count),
      mentionUnreadCount: Number(row.mention_unread_count)
    };
  }

  async listMessages(
    currentUserId: string,
    workspaceId: string,
    query: unknown
  ): Promise<ChatMessagePage> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const input = this.readPageInput(query);
    const rows = await selectChatMessages(this.database, workspaceId, input);
    const pageRows = rows.slice(0, input.limit);

    return {
      items: pageRows.slice().reverse().map(row => this.mapMessage(row)),
      nextCursor:
        rows.length > input.limit
          ? this.cursorForMessage(pageRows[pageRows.length - 1])
          : null
    };
  }

  async getMessageContext(
    currentUserId: string,
    workspaceId: string,
    messageId: string
  ): Promise<ChatMessageContext> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const normalizedMessageId = readChatUuid(messageId, "messageId");
    const target = await selectChatContextTarget(
      this.database,
      workspaceId,
      normalizedMessageId
    );
    if (!target) {
      throw notFound("Chat message not found");
    }

    const rows = await selectChatMessageContext(
      this.database,
      workspaceId,
      normalizedMessageId
    );
    return { items: rows.map(row => this.mapMessage(row)) };
  }

  async createMessage(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<{ message: WorkspaceChatMessage; replayed: boolean }> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const input = readCreateChatMessageBody(body);
    const requestFingerprint = computeChatRequestFingerprint(input);
    if (
      input.mentionedUserIds.some(
        mentionedId => mentionedId === currentUserId.toLowerCase()
      )
    ) {
      throw badRequest("A Chat message cannot mention its sender");
    }

    const result = await this.database.transaction(async transaction => {
      await lockChatIdempotencyKey(transaction, {
        workspaceId,
        userId: currentUserId,
        clientMessageId: input.clientMessageId
      });

      const existing = await selectChatMessageByClientId(transaction, {
        workspaceId,
        userId: currentUserId,
        clientMessageId: input.clientMessageId
      });
      if (existing) {
        return this.resolveIdempotentReplay(existing, requestFingerprint);
      }

      const targetRows = await selectChatMentionTargets(
        transaction,
        workspaceId,
        input.mentionedUserIds
      );
      const targetById = new Map(
        targetRows.map(target => [target.user_id, target])
      );
      const mentions = input.mentionedUserIds.map(mentionedId => {
        const target = targetById.get(mentionedId);
        if (!target) {
          throw badRequest(
            "mentionedUserIds must contain active Workspace members"
          );
        }

        const displayText = `@${target.display_name}`;
        if (!input.content.includes(displayText)) {
          throw badRequest(
            `Chat content must include mention token ${displayText}`
          );
        }

        return { userId: mentionedId, displayText };
      });

      const inserted = await insertChatMessage(transaction, {
        workspaceId,
        senderUserId: currentUserId,
        clientMessageId: input.clientMessageId,
        content: input.content,
        requestFingerprint
      });
      await insertChatMentions(transaction, {
        workspaceId,
        messageId: inserted.id,
        mentions
      });

      const created = await selectChatMessageById(
        transaction,
        workspaceId,
        inserted.id
      );
      if (!created) {
        throw new Error("Created Chat message could not be loaded");
      }

      return { message: this.mapMessage(created), replayed: false };
    });

    if (!result.replayed) {
      const event: ChatRedisEventV1 = {
        version: 1,
        type: "message.created",
        workspaceId,
        occurredAt: new Date().toISOString(),
        message: result.message,
        mentionedUserIds: result.message.mentions.map(mention => mention.userId)
      };
      await this.publisher.publish(event);
    }

    return result;
  }

  async deleteMessage(
    currentUserId: string,
    workspaceId: string,
    messageId: string
  ): Promise<WorkspaceChatMessage> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const normalizedMessageId = readChatUuid(messageId, "messageId");
    const result = await this.database.transaction(async transaction => {
      const existing = await selectChatMessageForUpdate(
        transaction,
        workspaceId,
        normalizedMessageId
      );
      if (!existing) {
        throw notFound("Chat message not found");
      }
      if (existing.sender_user_id !== currentUserId) {
        throw forbidden("Only the Chat message author can delete it");
      }
      if (existing.deleted_at !== null) {
        return { message: this.mapMessage(existing), deleted: false };
      }

      const deleted = await softDeleteChatMessage(
        transaction,
        workspaceId,
        normalizedMessageId,
        currentUserId
      );
      return { message: this.mapMessage(deleted), deleted: true };
    });

    if (result.deleted) {
      const deletedAt = result.message.deletedAt;
      if (!deletedAt) {
        throw new Error("Deleted Chat message is missing deletedAt");
      }
      await this.publisher.publish({
        version: 1,
        type: "message.deleted",
        workspaceId,
        occurredAt: new Date().toISOString(),
        messageId: result.message.id,
        deletedAt
      });
    }

    return result.message;
  }

  async updateReadState(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<ChatReadStatePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const input = readLastReadBody(body);
    const row = await this.database.transaction(transaction =>
      upsertChatReadState(transaction, {
        workspaceId,
        userId: currentUserId,
        messageId: input.lastReadMessageId
      })
    );

    return {
      lastReadMessageId: row.last_read_message_id,
      lastReadAt: this.toIsoString(row.last_read_at)
    };
  }

  async listMentions(
    currentUserId: string,
    workspaceId: string,
    query: unknown
  ): Promise<ChatMentionPage> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const input = this.readPageInput(query);
    const rows = await selectChatMentions(
      this.database,
      workspaceId,
      currentUserId,
      input
    );
    const pageRows = rows.slice(0, input.limit);

    return {
      items: pageRows.map(row => this.mapMention(row)),
      nextCursor:
        rows.length > input.limit
          ? this.cursorForMention(pageRows[pageRows.length - 1])
          : null
    };
  }

  async readMention(
    currentUserId: string,
    workspaceId: string,
    mentionId: string
  ): Promise<ChatMentionNotification> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const normalizedMentionId = readChatUuid(mentionId, "mentionId");
    const row = await markChatMentionRead(
      this.database,
      workspaceId,
      currentUserId,
      normalizedMentionId
    );
    if (!row) {
      throw notFound("Chat mention not found");
    }

    return this.mapMention(row);
  }

  private resolveIdempotentReplay(
    existing: ChatMessageRow,
    requestFingerprint: string
  ): { message: WorkspaceChatMessage; replayed: true } {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw idempotencyKeyReused();
    }

    return { message: this.mapMessage(existing), replayed: true };
  }

  private readPageInput(query: unknown): ChatPageInput {
    if (query === undefined || query === null) {
      return { before: null, limit: readChatLimit(undefined) };
    }
    if (typeof query !== "object" || Array.isArray(query)) {
      throw badRequest("Chat query must be an object");
    }

    const value = query as Record<string, unknown>;
    if (Object.keys(value).some(key => key !== "before" && key !== "limit")) {
      throw badRequest("Chat query contains unsupported fields");
    }
    const encodedCursor = readOptionalChatCursor(value.before);
    return {
      before: encodedCursor ? decodeChatCursor(encodedCursor) : null,
      limit: readChatLimit(value.limit)
    };
  }

  private mapMessage(row: ChatMessageRow): WorkspaceChatMessage {
    const deletedAt = this.toNullableIsoString(row.deleted_at);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      clientMessageId: row.client_message_id,
      content: deletedAt ? null : row.content,
      author:
        row.author_id === null
          ? null
          : {
              id: row.author_id,
              displayName: row.author_display_name ?? "PILO 사용자",
              avatarUrl: row.author_avatar_url
            },
      mentions: deletedAt ? [] : this.readMessageMentions(row.mentions),
      createdAt: this.toIsoString(row.created_at),
      deletedAt
    };
  }

  private mapMention(row: ChatMentionRow): ChatMentionNotification {
    return {
      id: row.id,
      readAt: this.toNullableIsoString(row.read_at),
      messageId: row.message_id,
      excerpt: row.excerpt,
      actor:
        row.actor_id === null
          ? null
          : {
              id: row.actor_id,
              displayName: row.actor_display_name ?? "PILO 사용자",
              avatarUrl: row.actor_avatar_url
            },
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      createdAt: this.toIsoString(row.created_at)
    };
  }

  private readMessageMentions(
    value: ChatMessageRow["mentions"]
  ): Array<{ userId: string; displayText: string }> {
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap(item => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("userId" in item) ||
        typeof item.userId !== "string" ||
        !("displayText" in item) ||
        typeof item.displayText !== "string"
      ) {
        return [];
      }
      return [{ userId: item.userId, displayText: item.displayText }];
    });
  }

  private cursorForMessage(row: ChatMessageRow | undefined): string | null {
    if (!row) return null;
    return encodeChatCursor({
      createdAt: this.toIsoString(row.created_at),
      id: row.id
    });
  }

  private cursorForMention(row: ChatMentionRow | undefined): string | null {
    if (!row) return null;
    return encodeChatCursor({
      createdAt: this.toIsoString(row.created_at),
      id: row.id
    });
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    return value === null ? null : this.toIsoString(value);
  }
}

function idempotencyKeyReused(): HttpException {
  return new HttpException(
    {
      success: false,
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "clientMessageId was already used with a different payload"
      }
    },
    HttpStatus.CONFLICT
  );
}
