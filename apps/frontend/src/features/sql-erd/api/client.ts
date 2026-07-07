import type {
  SqltoerdDialect,
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdSessionPayload,
  SqltoerdSettingsJson,
  SqltoerdSourceFormat
} from "@/features/sql-erd/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type SqlErdApiClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type SqlErdApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export type CreateSqlErdSessionRequest = {
  title: string;
  sourceFormat: SqltoerdSourceFormat;
  dialect: SqltoerdDialect;
  sourceText: string;
  modelJson: SqltoerdModelJsonV1;
  layoutJson: SqltoerdLayoutJsonV1;
  settingsJson: SqltoerdSettingsJson;
};

export type UpdateSqlErdSessionRequest = Partial<CreateSqlErdSessionRequest> & {
  baseRevision: number;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function defaultSqlErdApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ??
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getSqlErdApiBaseUrl(baseUrl = defaultSqlErdApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildSqlErdApiUrl(
  path: `/${string}`,
  baseUrl = defaultSqlErdApiBaseUrl()
) {
  return `${getSqlErdApiBaseUrl(baseUrl)}${path}`;
}

export class SqlErdApiError extends Error {
  status?: number;
  path?: string;
  code?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      path?: string;
      status?: number;
    } = {}
  ) {
    super(message);
    this.name = "SqlErdApiError";
    this.code = options.code;
    this.path = options.path;
    this.status = options.status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSqlErdApiError(payload: unknown) {
  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    return {
      code:
        typeof payload.error.code === "string"
          ? payload.error.code
          : undefined,
      message:
        typeof payload.error.message === "string"
          ? payload.error.message
          : "SQLtoERD API request failed"
    };
  }

  return null;
}

async function readSqlErdApiPayload(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new SqlErdApiError("SQLtoERD API returned invalid JSON", {
      path,
      status: response.status
    });
  }
}

function unwrapSqlErdApiPayload<T>(
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
    return (payload as SqlErdApiSuccessResponse<T>).data;
  }

  const apiError = readSqlErdApiError(payload);

  if (apiError) {
    throw new SqlErdApiError(apiError.message, {
      code: apiError.code,
      path,
      status
    });
  }

  throw new SqlErdApiError("SQLtoERD API returned an unexpected response", {
    path,
    status
  });
}

async function requestSqlErdApiPayload<T>(
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
  const headers = {
    Accept: "application/json",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(init?.headers ?? {})
  };

  const response = await fetcher(buildSqlErdApiUrl(path, baseUrl), {
    ...init,
    credentials: "same-origin",
    headers
  });
  const payload = await readSqlErdApiPayload(response, path);

  if (!response.ok) {
    const apiError = readSqlErdApiError(payload);

    throw new SqlErdApiError(
      apiError?.message ?? "SQLtoERD API request failed",
      {
        code: apiError?.code,
        path,
        status: response.status
      }
    );
  }

  return unwrapSqlErdApiPayload<T>(payload, {
    path,
    status: response.status
  });
}

export function createSqlErdApiClient({
  accessToken = null,
  baseUrl = defaultSqlErdApiBaseUrl(),
  fetcher = fetch
}: SqlErdApiClientOptions = {}) {
  const requestOptions = { accessToken, baseUrl, fetcher };

  return {
    async getActiveSession(workspaceId: string) {
      return requestSqlErdApiPayload<SqltoerdSessionPayload | null>(
        `/workspaces/${encodeURIComponent(workspaceId)}/sql-erd-session`,
        { method: "GET" },
        requestOptions
      );
    },

    async createSession(
      workspaceId: string,
      payload: CreateSqlErdSessionRequest
    ) {
      return requestSqlErdApiPayload<SqltoerdSessionPayload>(
        `/workspaces/${encodeURIComponent(workspaceId)}/sql-erd-session`,
        {
          body: JSON.stringify(payload),
          method: "POST"
        },
        requestOptions
      );
    },

    async updateSession(
      workspaceId: string,
      sessionId: string,
      payload: UpdateSqlErdSessionRequest
    ) {
      return requestSqlErdApiPayload<SqltoerdSessionPayload>(
        `/workspaces/${encodeURIComponent(workspaceId)}/sql-erd-session/${encodeURIComponent(sessionId)}`,
        {
          body: JSON.stringify(payload),
          method: "PATCH"
        },
        requestOptions
      );
    }
  };
}
