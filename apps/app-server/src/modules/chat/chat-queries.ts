import type { QueryResultRow } from "pg";
import { forbidden, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import type {
  ChatCursor,
  ChatMentionRow,
  ChatMentionTargetRow,
  ChatMessageRow,
  ChatReadStateRow,
  ChatSummaryRow,
  CreateChatMessageRecord
} from "./chat-types";

interface ChatQueryExecutor {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T | null>;
}

interface ChatIdRow extends QueryResultRow {
  id: string;
}

interface ChatLockedReadStateRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  last_read_message_id: string | null;
  last_read_at: Date | string | null;
  target_is_newer: boolean;
}

const CHAT_MESSAGE_PROJECTION = `
  message.id,
  message.workspace_id,
  message.sender_user_id,
  message.client_message_id,
  message.content,
  message.request_fingerprint,
  author.id AS author_id,
  CASE
    WHEN author.id IS NULL THEN NULL
    ELSE COALESCE(
      NULLIF(BTRIM(author_settings.display_name), ''),
      NULLIF(BTRIM(author.name), ''),
      NULLIF(split_part(author.email, '@', 1), ''),
      'PILO 사용자'
    )
  END AS author_display_name,
  CASE COALESCE(author_settings.avatar_mode, 'provider')
    WHEN 'custom' THEN author_settings.custom_avatar_url
    WHEN 'initials' THEN NULL
    ELSE author.avatar_url
  END AS author_avatar_url,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'userId', mention.mentioned_user_id,
          'displayText', mention.display_text
        )
        ORDER BY mention.created_at ASC, mention.id ASC
      )
      FROM workspace_chat_mentions AS mention
      WHERE mention.workspace_id = message.workspace_id
        AND mention.message_id = message.id
    ),
    '[]'::jsonb
  ) AS mentions,
  message.created_at,
  message.deleted_at
`;

const CHAT_AUTHOR_JOINS = `
  LEFT JOIN users AS author
    ON author.id = message.sender_user_id
  LEFT JOIN user_settings AS author_settings
    ON author_settings.user_id = author.id
`;

export async function selectChatMessages(
  database: DatabaseService,
  workspaceId: string,
  input: { before: ChatCursor | null; limit: number }
): Promise<ChatMessageRow[]> {
  return database.query<ChatMessageRow>(
    `
      SELECT ${CHAT_MESSAGE_PROJECTION}
      FROM workspace_chat_messages AS message
      ${CHAT_AUTHOR_JOINS}
      WHERE message.workspace_id = $1
        AND (
          $2::timestamptz IS NULL
          OR (message.created_at, message.id) < ($2::timestamptz, $3::uuid)
        )
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT $4
    `,
    [
      workspaceId,
      input.before?.createdAt ?? null,
      input.before?.id ?? null,
      input.limit + 1
    ]
  );
}

export async function insertChatMessage(
  transaction: DatabaseTransaction,
  input: CreateChatMessageRecord
): Promise<ChatMessageRow> {
  const row = await transaction.queryOne<ChatMessageRow>(
    `
      INSERT INTO workspace_chat_messages (
        workspace_id,
        sender_user_id,
        client_message_id,
        content,
        request_fingerprint
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        workspace_id,
        sender_user_id,
        client_message_id,
        content,
        request_fingerprint,
        NULL::uuid AS author_id,
        NULL::text AS author_display_name,
        NULL::text AS author_avatar_url,
        '[]'::jsonb AS mentions,
        created_at,
        deleted_at
    `,
    [
      input.workspaceId,
      input.senderUserId,
      input.clientMessageId,
      input.content,
      input.requestFingerprint
    ]
  );

  if (!row) {
    throw new Error("Chat message could not be created");
  }

  return row;
}

export async function upsertChatReadState(
  transaction: DatabaseTransaction,
  input: { workspaceId: string; userId: string; messageId: string }
): Promise<ChatReadStateRow> {
  const membership = await transaction.queryOne<ChatIdRow>(
    `
      SELECT membership.user_id AS id
      FROM workspace_members AS membership
      WHERE membership.workspace_id = $1
        AND membership.user_id = $2
      FOR KEY SHARE
    `,
    [input.workspaceId, input.userId]
  );
  if (!membership) {
    throw forbidden("Workspace access denied");
  }

  await transaction.execute(
    `
      INSERT INTO workspace_chat_reads (
        workspace_id,
        user_id
      )
      SELECT $1, $2
      FROM workspace_chat_messages AS target_message
      WHERE target_message.workspace_id = $1
        AND target_message.id = $3
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `,
    [input.workspaceId, input.userId, input.messageId]
  );

  const current = await transaction.queryOne<ChatLockedReadStateRow>(
    `
      SELECT
        read_state.workspace_id,
        read_state.user_id,
        read_state.last_read_message_id,
        read_state.last_read_at,
        (
          read_state.last_read_message_id IS NULL
          OR (target_message.created_at, target_message.id)
            > (current_message.created_at, current_message.id)
        ) AS target_is_newer
      FROM workspace_chat_reads AS read_state
      JOIN workspace_chat_messages AS target_message
        ON target_message.workspace_id = $1
       AND target_message.id = $3
      LEFT JOIN workspace_chat_messages AS current_message
        ON current_message.workspace_id = read_state.workspace_id
       AND current_message.id = read_state.last_read_message_id
      WHERE read_state.workspace_id = $1
        AND read_state.user_id = $2
      FOR UPDATE OF read_state
    `,
    [input.workspaceId, input.userId, input.messageId]
  );

  if (!current) {
    throw notFound("Chat message not found");
  }

  if (!current.target_is_newer) {
    if (!current.last_read_message_id || !current.last_read_at) {
      throw new Error("Current Chat read state is invalid");
    }
    return {
      workspace_id: current.workspace_id,
      user_id: current.user_id,
      last_read_message_id: current.last_read_message_id,
      last_read_at: current.last_read_at
    };
  }

  const row = await transaction.queryOne<ChatReadStateRow>(
    `
      UPDATE workspace_chat_reads AS read_state
      SET
        last_read_message_id = $3,
        last_read_at = now()
      WHERE read_state.workspace_id = $1
        AND read_state.user_id = $2
      RETURNING
        read_state.workspace_id,
        read_state.user_id,
        read_state.last_read_message_id,
        read_state.last_read_at
    `,
    [input.workspaceId, input.userId, input.messageId]
  );

  if (!row) {
    throw new Error("Chat read state could not be advanced");
  }

  return row;
}

export async function lockChatIdempotencyKey(
  transaction: DatabaseTransaction,
  input: { workspaceId: string; userId: string; clientMessageId: string }
): Promise<void> {
  await transaction.execute(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${input.workspaceId}:${input.userId}:${input.clientMessageId}`]
  );
}

export function selectChatMessageByClientId(
  transaction: DatabaseTransaction,
  input: { workspaceId: string; userId: string; clientMessageId: string }
): Promise<ChatMessageRow | null> {
  return transaction.queryOne<ChatMessageRow>(
    `
      SELECT ${CHAT_MESSAGE_PROJECTION}
      FROM workspace_chat_messages AS message
      ${CHAT_AUTHOR_JOINS}
      WHERE message.workspace_id = $1
        AND message.sender_user_id = $2
        AND message.client_message_id = $3
      FOR UPDATE OF message
    `,
    [input.workspaceId, input.userId, input.clientMessageId]
  );
}

export function selectChatMessageById(
  executor: ChatQueryExecutor,
  workspaceId: string,
  messageId: string
): Promise<ChatMessageRow | null> {
  return executor.queryOne<ChatMessageRow>(
    `
      SELECT ${CHAT_MESSAGE_PROJECTION}
      FROM workspace_chat_messages AS message
      ${CHAT_AUTHOR_JOINS}
      WHERE message.workspace_id = $1
        AND message.id = $2
    `,
    [workspaceId, messageId]
  );
}

export function selectChatMessageForUpdate(
  transaction: DatabaseTransaction,
  workspaceId: string,
  messageId: string
): Promise<ChatMessageRow | null> {
  return transaction.queryOne<ChatMessageRow>(
    `
      SELECT ${CHAT_MESSAGE_PROJECTION}
      FROM workspace_chat_messages AS message
      ${CHAT_AUTHOR_JOINS}
      WHERE message.workspace_id = $1
        AND message.id = $2
      FOR UPDATE OF message
    `,
    [workspaceId, messageId]
  );
}

export function selectChatMentionTargets(
  transaction: DatabaseTransaction,
  workspaceId: string,
  userIds: string[]
): Promise<ChatMentionTargetRow[]> {
  if (userIds.length === 0) return Promise.resolve([]);

  return transaction.query<ChatMentionTargetRow>(
    `
      SELECT
        membership.user_id,
        COALESCE(
          NULLIF(BTRIM(settings.display_name), ''),
          NULLIF(BTRIM(member.name), ''),
          NULLIF(split_part(member.email, '@', 1), ''),
          'PILO 사용자'
        ) AS display_name
      FROM workspace_members AS membership
      JOIN users AS member
        ON member.id = membership.user_id
      LEFT JOIN user_settings AS settings
        ON settings.user_id = member.id
      WHERE membership.workspace_id = $1
        AND membership.user_id = ANY($2::uuid[])
    `,
    [workspaceId, userIds]
  );
}

export async function insertChatMentions(
  transaction: DatabaseTransaction,
  input: {
    workspaceId: string;
    messageId: string;
    mentions: Array<{ userId: string; displayText: string }>;
  }
): Promise<void> {
  if (input.mentions.length === 0) return;

  await transaction.execute(
    `
      INSERT INTO workspace_chat_mentions (
        workspace_id,
        message_id,
        mentioned_user_id,
        display_text
      )
      SELECT $1, $2, mention.user_id, mention.display_text
      FROM unnest($3::uuid[], $4::text[]) AS mention(user_id, display_text)
    `,
    [
      input.workspaceId,
      input.messageId,
      input.mentions.map(mention => mention.userId),
      input.mentions.map(mention => mention.displayText)
    ]
  );
}

export async function softDeleteChatMessage(
  transaction: DatabaseTransaction,
  workspaceId: string,
  messageId: string,
  currentUserId: string
): Promise<ChatMessageRow> {
  await transaction.execute(
    `
      UPDATE workspace_chat_messages
      SET
        content = NULL,
        deleted_at = now(),
        deleted_by_user_id = $3
      WHERE workspace_id = $1
        AND id = $2
        AND sender_user_id = $3
        AND deleted_at IS NULL
    `,
    [workspaceId, messageId, currentUserId]
  );

  const message = await selectChatMessageById(
    transaction,
    workspaceId,
    messageId
  );
  if (!message) {
    throw new Error("Deleted Chat message could not be loaded");
  }

  return message;
}

export function selectChatSummary(
  database: DatabaseService,
  workspaceId: string,
  currentUserId: string
): Promise<ChatSummaryRow | null> {
  return database.queryOne<ChatSummaryRow>(
    `
      SELECT
        (
          SELECT latest_message.id
          FROM workspace_chat_messages AS latest_message
          WHERE latest_message.workspace_id = $1
          ORDER BY latest_message.created_at DESC, latest_message.id DESC
          LIMIT 1
        ) AS latest_message_id,
        read_state.last_read_message_id,
        (
          SELECT COUNT(*)
          FROM workspace_chat_messages AS unread_message
          WHERE unread_message.workspace_id = $1
            AND unread_message.deleted_at IS NULL
            AND (
              unread_message.sender_user_id <> $2
              OR unread_message.sender_user_id IS NULL
            )
            AND (
              (
                read_state.last_read_message_id IS NULL
                AND unread_message.created_at >= membership.joined_at
              )
              OR (
                read_state.last_read_message_id IS NOT NULL
                AND (unread_message.created_at, unread_message.id) > (
                  SELECT read_message.created_at, read_message.id
                  FROM workspace_chat_messages AS read_message
                  WHERE read_message.workspace_id = $1
                    AND read_message.id = read_state.last_read_message_id
                )
              )
            )
        ) AS unread_count,
        (
          SELECT COUNT(*)
          FROM workspace_chat_mentions AS mention
          JOIN workspace_chat_messages AS mention_message
            ON mention_message.workspace_id = mention.workspace_id
           AND mention_message.id = mention.message_id
          WHERE mention.workspace_id = $1
            AND mention.mentioned_user_id = $2
            AND mention.read_at IS NULL
            AND mention_message.deleted_at IS NULL
        ) AS mention_unread_count
      FROM workspace_members AS membership
      LEFT JOIN workspace_chat_reads AS read_state
        ON read_state.workspace_id = membership.workspace_id
       AND read_state.user_id = membership.user_id
      WHERE membership.workspace_id = $1
        AND membership.user_id = $2
    `,
    [workspaceId, currentUserId]
  );
}

export function selectChatContextTarget(
  database: DatabaseService,
  workspaceId: string,
  messageId: string
): Promise<ChatIdRow | null> {
  return database.queryOne<ChatIdRow>(
    `
      SELECT target.id
      FROM workspace_chat_messages AS target
      WHERE target.workspace_id = $1
        AND target.id = $2
    `,
    [workspaceId, messageId]
  );
}

export function selectChatMessageContext(
  database: DatabaseService,
  workspaceId: string,
  messageId: string
): Promise<ChatMessageRow[]> {
  return database.query<ChatMessageRow>(
    `
      WITH target AS (
        SELECT target_message.id, target_message.created_at
        FROM workspace_chat_messages AS target_message
        WHERE target_message.workspace_id = $1
          AND target_message.id = $2
      ),
      context_ids AS (
        (
          SELECT before_message.id, before_message.created_at
          FROM workspace_chat_messages AS before_message
          CROSS JOIN target
          WHERE before_message.workspace_id = $1
            AND (before_message.created_at, before_message.id)
              < (target.created_at, target.id)
          ORDER BY before_message.created_at DESC, before_message.id DESC
          LIMIT 25
        )
        UNION ALL
        SELECT target.id, target.created_at FROM target
        UNION ALL
        (
          SELECT after_message.id, after_message.created_at
          FROM workspace_chat_messages AS after_message
          CROSS JOIN target
          WHERE after_message.workspace_id = $1
            AND (after_message.created_at, after_message.id)
              > (target.created_at, target.id)
          ORDER BY after_message.created_at ASC, after_message.id ASC
          LIMIT 25
        )
      )
      SELECT ${CHAT_MESSAGE_PROJECTION}
      FROM context_ids
      JOIN workspace_chat_messages AS message
        ON message.workspace_id = $1
       AND message.id = context_ids.id
      ${CHAT_AUTHOR_JOINS}
      ORDER BY message.created_at ASC, message.id ASC
    `,
    [workspaceId, messageId]
  );
}

const CHAT_MENTION_PROJECTION = `
  mention.id,
  mention.read_at,
  mention.message_id,
  LEFT(message.content, 240) AS excerpt,
  actor.id AS actor_id,
  CASE
    WHEN actor.id IS NULL THEN NULL
    ELSE COALESCE(
      NULLIF(BTRIM(actor_settings.display_name), ''),
      NULLIF(BTRIM(actor.name), ''),
      NULLIF(split_part(actor.email, '@', 1), ''),
      'PILO 사용자'
    )
  END AS actor_display_name,
  CASE COALESCE(actor_settings.avatar_mode, 'provider')
    WHEN 'custom' THEN actor_settings.custom_avatar_url
    WHEN 'initials' THEN NULL
    ELSE actor.avatar_url
  END AS actor_avatar_url,
  mention.workspace_id,
  workspace.name AS workspace_name,
  mention.created_at
`;

const CHAT_MENTION_JOINS = `
  JOIN workspace_chat_messages AS message
    ON message.workspace_id = mention.workspace_id
   AND message.id = mention.message_id
  JOIN workspaces AS workspace
    ON workspace.id = mention.workspace_id
  LEFT JOIN users AS actor
    ON actor.id = message.sender_user_id
  LEFT JOIN user_settings AS actor_settings
    ON actor_settings.user_id = actor.id
`;

export function selectChatMentions(
  database: DatabaseService,
  workspaceId: string,
  currentUserId: string,
  input: { before: ChatCursor | null; limit: number }
): Promise<ChatMentionRow[]> {
  return database.query<ChatMentionRow>(
    `
      SELECT ${CHAT_MENTION_PROJECTION}
      FROM workspace_chat_mentions AS mention
      ${CHAT_MENTION_JOINS}
      WHERE mention.workspace_id = $1
        AND mention.mentioned_user_id = $2
        AND message.deleted_at IS NULL
        AND (
          $3::timestamptz IS NULL
          OR (mention.created_at, mention.id) < ($3::timestamptz, $4::uuid)
        )
      ORDER BY mention.created_at DESC, mention.id DESC
      LIMIT $5
    `,
    [
      workspaceId,
      currentUserId,
      input.before?.createdAt ?? null,
      input.before?.id ?? null,
      input.limit + 1
    ]
  );
}

export function markChatMentionRead(
  database: DatabaseService,
  workspaceId: string,
  currentUserId: string,
  mentionId: string
): Promise<ChatMentionRow | null> {
  return database.queryOne<ChatMentionRow>(
    `
      WITH updated_mention AS (
        UPDATE workspace_chat_mentions AS mention
        SET read_at = COALESCE(mention.read_at, now())
        WHERE mention.workspace_id = $1
          AND mention.mentioned_user_id = $2
          AND mention.id = $3
        RETURNING mention.*
      )
      SELECT
        updated_mention.id,
        updated_mention.read_at,
        updated_mention.message_id,
        CASE
          WHEN message.deleted_at IS NULL THEN LEFT(message.content, 240)
          ELSE '삭제된 메시지입니다'
        END AS excerpt,
        actor.id AS actor_id,
        CASE
          WHEN actor.id IS NULL THEN NULL
          ELSE COALESCE(
            NULLIF(BTRIM(actor_settings.display_name), ''),
            NULLIF(BTRIM(actor.name), ''),
            NULLIF(split_part(actor.email, '@', 1), ''),
            'PILO 사용자'
          )
        END AS actor_display_name,
        CASE COALESCE(actor_settings.avatar_mode, 'provider')
          WHEN 'custom' THEN actor_settings.custom_avatar_url
          WHEN 'initials' THEN NULL
          ELSE actor.avatar_url
        END AS actor_avatar_url,
        updated_mention.workspace_id,
        workspace.name AS workspace_name,
        updated_mention.created_at
      FROM updated_mention
      JOIN workspace_chat_messages AS message
        ON message.workspace_id = updated_mention.workspace_id
       AND message.id = updated_mention.message_id
      JOIN workspaces AS workspace
        ON workspace.id = updated_mention.workspace_id
      LEFT JOIN users AS actor
        ON actor.id = message.sender_user_id
      LEFT JOIN user_settings AS actor_settings
        ON actor_settings.user_id = actor.id
    `,
    [workspaceId, currentUserId, mentionId]
  );
}
