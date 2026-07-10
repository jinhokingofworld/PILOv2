import type {
  BoardColumnPayload,
  BoardDetailPayload,
  BoardFilterOptionsPayload,
  BoardIssueCardPayload,
  BoardIssueDetailPayload,
  BoardPaginatedPayload,
  BoardPayload,
  BoardRelatedPullRequestPayload,
  CreateBoardInput,
  CreateBoardIssueCommand,
  CreateBoardIssuePayload,
  ListBoardIssuesQuery,
  ListBoardsQuery,
  UpdateBoardIssueInput,
  UpdateBoardIssuePayload,
  UpdateBoardIssueStatusInput,
  UpdateBoardIssueStatusPayload
} from "@/features/board/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type BoardClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type BoardApiSuccessResponse<T> = {
  success: true;
  data: T;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultBoardApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getBoardApiBaseUrl(baseUrl = defaultBoardApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildBoardApiUrl(
  path: `/${string}`,
  baseUrl = defaultBoardApiBaseUrl()
) {
  return `${getBoardApiBaseUrl(baseUrl)}${path}`;
}

export class BoardApiError extends Error {
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
    this.name = "BoardApiError";
    this.status = options.status;
    this.path = options.path;
    this.code = options.code;
  }
}

function readApiErrorMessage(payload: unknown) {
  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    return {
      code:
        typeof payload.error.code === "string"
          ? payload.error.code
          : undefined,
      message: payload.error.message
    };
  }

  return null;
}

async function readBoardJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new BoardApiError("Board API returned invalid JSON", {
      status: response.status,
      path
    });
  }
}

function unwrapBoardData<T>(
  payload: unknown,
  {
    path,
    status
  }: {
    path: string;
    status: number;
  }
) {
  if (
    isRecord(payload) &&
    payload.success === true &&
    Object.hasOwn(payload, "data")
  ) {
    return (payload as BoardApiSuccessResponse<T>).data;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new BoardApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Board API request failed",
      {
        code:
          typeof payload.error.code === "string"
            ? payload.error.code
            : undefined,
        path,
        status
      }
    );
  }

  throw new BoardApiError("Board API returned an unexpected response", {
    path,
    status
  });
}

function appendSearchParam(
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined
) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  params.set(key, String(value));
}

function withQueryParams(path: `/${string}`, query: object = {}) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      appendSearchParam(params, key, value);
    }
  }

  const search = params.toString();
  return search ? (`${path}?${search}` as `/${string}`) : path;
}

function withJsonBody(body: unknown, init: RequestInit = {}) {
  return {
    ...init,
    body: JSON.stringify(body)
  };
}

async function requestBoardData<T>(
  path: `/${string}`,
  init: RequestInit | undefined,
  {
    accessToken,
    baseUrl,
    fetcher
  }: {
    accessToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  }
) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetcher(buildBoardApiUrl(path, baseUrl), {
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readBoardJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new BoardApiError(apiError?.message ?? "Board API request failed", {
      code: apiError?.code,
      path,
      status: response.status
    });
  }

  return unwrapBoardData<T>(payload, {
    path,
    status: response.status
  });
}

function boardsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/boards` as const;
}

function boardPath(workspaceId: string, boardId: string) {
  return `${boardsPath(workspaceId)}/${encodeURIComponent(boardId)}` as const;
}

function boardIssuePath(workspaceId: string, boardId: string, issueId: string) {
  return `${boardPath(workspaceId, boardId)}/issues/${encodeURIComponent(
    issueId
  )}` as const;
}

export function createBoardApiClient({
  accessToken = null,
  baseUrl = defaultBoardApiBaseUrl(),
  fetcher = fetch
}: BoardClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async listBoards(workspaceId: string, query: ListBoardsQuery = {}) {
      return requestBoardData<BoardPaginatedPayload<BoardPayload>>(
        withQueryParams(boardsPath(workspaceId), query),
        undefined,
        requestOptions
      );
    },

    async createBoard(workspaceId: string, body: CreateBoardInput) {
      return requestBoardData<BoardPayload>(
        boardsPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async getBoard(workspaceId: string, boardId: string) {
      return requestBoardData<BoardDetailPayload>(
        boardPath(workspaceId, boardId),
        undefined,
        requestOptions
      );
    },

    async listBoardColumns(workspaceId: string, boardId: string) {
      return requestBoardData<BoardColumnPayload[]>(
        `${boardPath(workspaceId, boardId)}/columns`,
        undefined,
        requestOptions
      );
    },

    async listBoardIssues(
      workspaceId: string,
      boardId: string,
      query: ListBoardIssuesQuery = {}
    ) {
      return requestBoardData<BoardPaginatedPayload<BoardIssueCardPayload>>(
        withQueryParams(`${boardPath(workspaceId, boardId)}/issues`, query),
        undefined,
        requestOptions
      );
    },

    async createBoardIssue(
      workspaceId: string,
      boardId: string,
      body: CreateBoardIssueCommand
    ) {
      const { idempotencyKey, ...requestBody } = body;

      return requestBoardData<CreateBoardIssuePayload>(
        `${boardPath(workspaceId, boardId)}/issues`,
        withJsonBody(requestBody, {
          headers: { "Idempotency-Key": idempotencyKey },
          method: "POST"
        }),
        requestOptions
      );
    },

    async getBoardIssue(
      workspaceId: string,
      boardId: string,
      issueId: string
    ) {
      return requestBoardData<BoardIssueDetailPayload>(
        boardIssuePath(workspaceId, boardId, issueId),
        undefined,
        requestOptions
      );
    },

    async updateBoardIssueStatus(
      workspaceId: string,
      boardId: string,
      issueId: string,
      body: UpdateBoardIssueStatusInput
    ) {
      return requestBoardData<UpdateBoardIssueStatusPayload>(
        `${boardIssuePath(workspaceId, boardId, issueId)}/status`,
        withJsonBody(body, { method: "PATCH" }),
        requestOptions
      );
    },

    async updateBoardIssue(
      workspaceId: string,
      boardId: string,
      issueId: string,
      body: UpdateBoardIssueInput
    ) {
      return requestBoardData<UpdateBoardIssuePayload>(
        boardIssuePath(workspaceId, boardId, issueId),
        withJsonBody(body, { method: "PATCH" }),
        requestOptions
      );
    },

    async listBoardIssuePullRequests(
      workspaceId: string,
      boardId: string,
      issueId: string
    ) {
      return requestBoardData<BoardRelatedPullRequestPayload[]>(
        `${boardIssuePath(workspaceId, boardId, issueId)}/pull-requests`,
        undefined,
        requestOptions
      );
    },

    async getBoardFilterOptions(workspaceId: string, boardId: string) {
      return requestBoardData<BoardFilterOptionsPayload>(
        `${boardPath(workspaceId, boardId)}/filter-options`,
        undefined,
        requestOptions
      );
    }
  };
}
