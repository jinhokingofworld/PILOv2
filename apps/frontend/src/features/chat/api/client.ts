import type {
  ChatMentionNotification,
  ChatMentionPage,
  ChatMessageContext,
  ChatMessagePage,
  ChatReadState,
  ChatSummary,
  CreateChatMessageInput,
  WorkspaceChatMessage
} from "@/features/chat/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

type ChatRequestOptions = {
  signal?: AbortSignal;
};

type ChatPageOptions = ChatRequestOptions & {
  before?: string | null;
  limit?: number;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getChatApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function buildChatApiUrl(path: `/${string}`) {
  return `${getChatApiBaseUrl()}${path}`;
}

export class ChatApiError extends Error {
  status?: number;
  path?: string;
  code?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      path?: string;
      code?: string;
    } = {}
  ) {
    super(message);
    this.name = "ChatApiError";
    this.status = options.status;
    this.path = options.path;
    this.code = options.code;
  }
}

export function getChatSummary(
  accessToken: string,
  workspaceId: string,
  options: ChatRequestOptions = {}
) {
  return requestChatData<ChatSummary>(chatPath(workspaceId, "/summary"), {
    accessToken,
    method: "GET",
    signal: options.signal
  });
}

export function listChatMessages(
  accessToken: string,
  workspaceId: string,
  options: ChatPageOptions = {}
) {
  return requestChatData<ChatMessagePage>(
    withPageQuery(chatPath(workspaceId, "/messages"), options),
    {
      accessToken,
      method: "GET",
      signal: options.signal
    }
  );
}

export function getChatMessageContext(
  accessToken: string,
  workspaceId: string,
  messageId: string,
  options: ChatRequestOptions = {}
) {
  return requestChatData<ChatMessageContext>(
    chatPath(
      workspaceId,
      `/messages/${encodeURIComponent(messageId)}/context`
    ),
    {
      accessToken,
      method: "GET",
      signal: options.signal
    }
  );
}

export function createChatMessage(
  accessToken: string,
  workspaceId: string,
  input: CreateChatMessageInput,
  options: ChatRequestOptions = {}
) {
  return requestChatData<WorkspaceChatMessage>(
    chatPath(workspaceId, "/messages"),
    {
      accessToken,
      body: input,
      method: "POST",
      signal: options.signal
    }
  );
}

export function deleteChatMessage(
  accessToken: string,
  workspaceId: string,
  messageId: string,
  options: ChatRequestOptions = {}
) {
  return requestChatData<WorkspaceChatMessage>(
    chatPath(workspaceId, `/messages/${encodeURIComponent(messageId)}`),
    {
      accessToken,
      method: "DELETE",
      signal: options.signal
    }
  );
}

export function updateChatReadState(
  accessToken: string,
  workspaceId: string,
  lastReadMessageId: string,
  options: ChatRequestOptions = {}
) {
  return requestChatData<ChatReadState>(
    chatPath(workspaceId, "/read-state"),
    {
      accessToken,
      body: { lastReadMessageId },
      method: "PUT",
      signal: options.signal
    }
  );
}

export function listChatMentions(
  accessToken: string,
  workspaceId: string,
  options: ChatPageOptions = {}
) {
  return requestChatData<ChatMentionPage>(
    withPageQuery(chatPath(workspaceId, "/mentions"), options),
    {
      accessToken,
      method: "GET",
      signal: options.signal
    }
  );
}

export function readChatMention(
  accessToken: string,
  workspaceId: string,
  mentionId: string,
  options: ChatRequestOptions = {}
) {
  return requestChatData<ChatMentionNotification>(
    chatPath(
      workspaceId,
      `/mentions/${encodeURIComponent(mentionId)}/read`
    ),
    {
      accessToken,
      method: "PUT",
      signal: options.signal
    }
  );
}

function chatPath(workspaceId: string, path: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/chat${path}` as const;
}

function withPageQuery(path: `/${string}`, options: ChatPageOptions) {
  const params = new URLSearchParams();
  if (options.before) params.set("before", options.before);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.toString();
  return query ? (`${path}?${query}` as `/${string}`) : path;
}

async function requestChatData<T>(
  path: `/${string}`,
  {
    accessToken,
    body,
    method,
    signal
  }: {
    accessToken: string;
    body?: unknown;
    method: string;
    signal?: AbortSignal;
  }
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(buildChatApiUrl(path), {
    method,
    credentials: "same-origin",
    headers,
    signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ChatApiError("Chat API returned invalid JSON", {
      path,
      status: response.status
    });
  }

  if (!response.ok) {
    const apiError = readApiError(payload);
    throw new ChatApiError(apiError?.message ?? "Chat API request failed", {
      code: apiError?.code,
      path,
      status: response.status
    });
  }

  if (!isApiSuccessResponse<T>(payload)) {
    throw new ChatApiError("Chat API returned an unexpected response", {
      path,
      status: response.status
    });
  }

  return payload.data;
}

function isApiSuccessResponse<T>(value: unknown): value is ApiSuccessResponse<T> {
  return (
    isRecord(value) &&
    value.success === true &&
    Object.hasOwn(value, "data")
  );
}

function readApiError(value: unknown) {
  if (
    !isRecord(value) ||
    value.success !== false ||
    !isRecord(value.error)
  ) {
    return null;
  }

  return {
    code:
      typeof value.error.code === "string" ? value.error.code : undefined,
    message:
      typeof value.error.message === "string"
        ? value.error.message
        : "Chat API request failed"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
