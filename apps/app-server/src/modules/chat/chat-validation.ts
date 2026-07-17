import { badRequest } from "../../common/api-error";
import type { ChatCursor } from "./chat-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_CHAT_LIMIT = 50;
const MAX_CHAT_LIMIT = 100;
const MAX_CONTENT_CHARACTERS = 4_000;
const MAX_CLIENT_MESSAGE_ID_CHARACTERS = 128;
const MAX_MENTION_COUNT = 20;

export function readCreateChatMessageBody(body: unknown): {
  clientMessageId: string;
  content: string;
  mentionedUserIds: string[];
} {
  const value = readObject(body, "Chat message request body is required");
  assertOnlyKeys(value, ["clientMessageId", "content", "mentionedUserIds"]);

  const clientMessageId = readBoundedString(
    value.clientMessageId,
    "clientMessageId",
    MAX_CLIENT_MESSAGE_ID_CHARACTERS
  );
  const content = readBoundedString(
    value.content,
    "content",
    MAX_CONTENT_CHARACTERS
  );
  const mentionedUserIds = readMentionedUserIds(value.mentionedUserIds);

  return { clientMessageId, content, mentionedUserIds };
}

export function readChatLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CHAT_LIMIT;
  }

  const limit = typeof value === "string" ? Number(value) : value;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CHAT_LIMIT
  ) {
    throw badRequest("Chat limit must be an integer between 1 and 100");
  }

  return limit;
}

export function readOptionalChatCursor(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw invalidCursor();
  }

  decodeChatCursor(value);
  return value;
}

export function readLastReadBody(body: unknown): {
  lastReadMessageId: string;
} {
  const value = readObject(body, "Chat read-state request body is required");
  assertOnlyKeys(value, ["lastReadMessageId"]);

  return {
    lastReadMessageId: readChatUuid(
      value.lastReadMessageId,
      "lastReadMessageId"
    )
  };
}

export function readChatUuid(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw badRequest(`${fieldName} must be a UUID`);
  }

  return value.toLowerCase();
}

export function encodeChatCursor(cursor: ChatCursor): string {
  assertCursor(cursor);
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeChatCursor(value: string): ChatCursor {
  if (!value || !BASE64URL_PATTERN.test(value)) {
    throw invalidCursor();
  }

  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw new Error("cursor is not canonical base64url");
    }
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalidCursor();
  }

  if (!isChatCursor(parsed)) {
    throw invalidCursor();
  }

  assertCursor(parsed);
  return parsed;
}

function readObject(
  value: unknown,
  message: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(message);
  }

  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[]
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw badRequest("Chat request contains unsupported fields");
  }
}

function readBoundedString(
  value: unknown,
  fieldName: string,
  maxCharacters: number
): string {
  if (typeof value !== "string") {
    throw badRequest(`${fieldName} is required`);
  }

  const normalized = value.trim();
  const characterCount = Array.from(normalized).length;
  if (characterCount < 1 || characterCount > maxCharacters) {
    throw badRequest(
      `${fieldName} must be between 1 and ${maxCharacters} characters`
    );
  }

  return normalized;
}

function readMentionedUserIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw badRequest("mentionedUserIds must be an array");
  }

  const uniqueIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const userId = readChatUuid(candidate, "mentionedUserIds item");
    if (!seen.has(userId)) {
      seen.add(userId);
      uniqueIds.push(userId);
    }
  }

  if (uniqueIds.length > MAX_MENTION_COUNT) {
    throw badRequest("mentionedUserIds cannot contain more than 20 users");
  }

  return uniqueIds;
}

function isChatCursor(value: unknown): value is ChatCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("createdAt") &&
    keys.includes("id") &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function assertCursor(cursor: ChatCursor): void {
  if (!UUID_PATTERN.test(cursor.id)) {
    throw invalidCursor();
  }

  const date = new Date(cursor.createdAt);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== cursor.createdAt
  ) {
    throw invalidCursor();
  }
}

function invalidCursor(): ReturnType<typeof badRequest> {
  return badRequest("Chat cursor is invalid");
}
