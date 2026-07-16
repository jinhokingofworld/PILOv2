const MAX_IDENTIFIER_LENGTH = 256;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceChatMessage = {
  id: string;
  workspaceId: string;
  clientMessageId: string;
  content: string | null;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  mentions: Array<{ userId: string; displayText: string }>;
  createdAt: string;
  deletedAt: string | null;
};

export type ChatRedisEventV1 =
  | {
      version: 1;
      type: "message.created";
      workspaceId: string;
      occurredAt: string;
      message: WorkspaceChatMessage;
      mentionedUserIds: string[];
    }
  | {
      version: 1;
      type: "message.deleted";
      workspaceId: string;
      occurredAt: string;
      messageId: string;
      deletedAt: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const valueKeys = Object.keys(value);
  return (
    valueKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= MAX_IDENTIFIER_LENGTH
  );
}

function isIsoDateString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isChatAuthor(value: unknown): value is NonNullable<WorkspaceChatMessage["author"]> {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "displayName", "avatarUrl"])) {
    return false;
  }

  return (
    isIdentifier(value.id) &&
    typeof value.displayName === "string" &&
    isNullableString(value.avatarUrl)
  );
}

function isChatMention(
  value: unknown,
): value is WorkspaceChatMessage["mentions"][number] {
  if (!isRecord(value) || !hasExactKeys(value, ["userId", "displayText"])) {
    return false;
  }

  return isIdentifier(value.userId) && typeof value.displayText === "string";
}

function isWorkspaceChatMessage(
  value: unknown,
  workspaceId: string,
): value is WorkspaceChatMessage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "workspaceId",
      "clientMessageId",
      "content",
      "author",
      "mentions",
      "createdAt",
      "deletedAt",
    ])
  ) {
    return false;
  }

  return (
    isIdentifier(value.id) &&
    value.workspaceId === workspaceId &&
    isIdentifier(value.clientMessageId) &&
    isNullableString(value.content) &&
    (value.author === null || isChatAuthor(value.author)) &&
    Array.isArray(value.mentions) &&
    value.mentions.every(isChatMention) &&
    isIsoDateString(value.createdAt) &&
    (value.deletedAt === null || isIsoDateString(value.deletedAt))
  );
}

export function readChatRoomRef(
  payload: unknown,
): { workspaceId: string } | null {
  if (!isRecord(payload) || !hasExactKeys(payload, ["workspaceId"])) {
    return null;
  }

  if (typeof payload.workspaceId !== "string") return null;
  const workspaceId = payload.workspaceId.trim();
  if (!UUID_PATTERN.test(workspaceId)) return null;
  return { workspaceId };
}

export function isChatRedisEvent(
  value: unknown,
): value is ChatRedisEventV1 {
  if (!isRecord(value) || value.version !== 1 || !isIdentifier(value.workspaceId)) {
    return false;
  }

  if (value.type === "message.created") {
    return (
      hasExactKeys(value, [
        "version",
        "type",
        "workspaceId",
        "occurredAt",
        "message",
        "mentionedUserIds",
      ]) &&
      isIsoDateString(value.occurredAt) &&
      isWorkspaceChatMessage(value.message, value.workspaceId) &&
      Array.isArray(value.mentionedUserIds) &&
      value.mentionedUserIds.every(isIdentifier)
    );
  }

  if (value.type === "message.deleted") {
    return (
      hasExactKeys(value, [
        "version",
        "type",
        "workspaceId",
        "occurredAt",
        "messageId",
        "deletedAt",
      ]) &&
      isIsoDateString(value.occurredAt) &&
      isIdentifier(value.messageId) &&
      isIsoDateString(value.deletedAt)
    );
  }

  return false;
}
