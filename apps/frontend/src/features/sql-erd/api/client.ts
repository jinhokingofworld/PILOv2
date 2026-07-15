import type {
  SqltoerdDialect,
  SqltoerdLayoutJsonV1,
  SqltoerdModelJsonV1,
  SqltoerdSessionDeletePayload,
  SqltoerdSessionListPayload,
  SqltoerdSessionPayload,
  SqltoerdSettingsJson,
  SqltoerdSourceFormat
} from "@/features/sql-erd/types";
import type { SqlErdOperationPayload } from "@/features/sql-erd/realtime/sql-erd-realtime-types";

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
  modelJson: SqltoerdModelJsonV1;
  layoutJson: SqltoerdLayoutJsonV1;
  title?: string;
  sourceFormat?: SqltoerdSourceFormat;
  dialect?: SqltoerdDialect;
  sourceText?: string;
  settingsJson?: SqltoerdSettingsJson;
};

export type UpdateSqlErdSessionRequest = Partial<CreateSqlErdSessionRequest> & {
  baseRevision: number;
};

export type ListSqlErdSessionsQuery = {
  cursor?: string | null;
  limit?: number;
};

export type SqlErdOperationListPayload = {
  items: SqlErdOperationPayload[];
  latestOpSeq: number;
  nextAfterSeq: number | null;
};

export type SqlErdCreateOperationRequest = {
  baseRevision: number;
  clientOperationId: string;
  patch: Record<string, unknown>;
  type: "layout_patch";
};

export type SqlErdOperationWritePayload = {
  latestOpSeq: number;
  layoutJson: SqltoerdLayoutJsonV1;
  operation: SqlErdOperationPayload;
  revision: number;
};

export type SqlErdSourceLockPayload = {
  expiresAt: string;
  leaseId: string;
  sourceBaseRevision: number;
};

export type SqlErdSourceSnapshotPayload = {
  baseRevision: number;
  createdAt: string;
  createdBy: string;
  dialect: SqltoerdDialect;
  id: string;
  layoutJson: SqltoerdLayoutJsonV1;
  modelJson: SqltoerdModelJsonV1;
  relationCount: number;
  resultRevision: number;
  sourceFormat: SqltoerdSourceFormat;
  sourceText: string;
  tableCount: number;
};

export type SqlErdSourcePublishRequest = {
  baseRevision: number;
  clientOperationId: string;
  dialect: SqltoerdDialect;
  leaseId: string;
  modelJson: SqltoerdModelJsonV1;
  sourceFormat: SqltoerdSourceFormat;
  sourceText: string;
};

export type SqlErdSourcePublishPayload = {
  latestOpSeq: number;
  layoutJson: SqltoerdLayoutJsonV1;
  operation: SqlErdOperationPayload;
  rebaseSummary: {
    createdTableLayoutIds: string[];
    removedAnnotationLinkIds: string[];
    removedTableLayoutIds: string[];
  };
  revision: number;
  snapshot: SqlErdSourceSnapshotPayload;
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

  function sessionsPath(workspaceId: string) {
    return `/workspaces/${encodeURIComponent(workspaceId)}/sql-erd-sessions` as const;
  }

  function sessionPath(workspaceId: string, sessionId: string) {
    return `${sessionsPath(workspaceId)}/${encodeURIComponent(sessionId)}` as const;
  }

  function operationsPath(workspaceId: string, sessionId: string) {
    return `${sessionPath(workspaceId, sessionId)}/operations` as const;
  }

  function sourceSnapshotsPath(workspaceId: string, sessionId: string) {
    return `${sessionPath(workspaceId, sessionId)}/source-snapshots` as const;
  }

  function sourceLockPath(workspaceId: string, sessionId: string) {
    return `${sessionPath(workspaceId, sessionId)}/source-lock` as const;
  }

  return {
    async listSessions(
      workspaceId: string,
      { cursor = null, limit }: ListSqlErdSessionsQuery = {}
    ) {
      const searchParams = new URLSearchParams();

      if (limit !== undefined) {
        searchParams.set("limit", String(limit));
      }

      if (cursor) {
        searchParams.set("cursor", cursor);
      }

      const queryString = searchParams.toString();
      const path = `${sessionsPath(workspaceId)}${queryString ? `?${queryString}` : ""}` as `/${string}`;

      return requestSqlErdApiPayload<SqltoerdSessionListPayload>(
        path,
        { method: "GET" },
        requestOptions
      );
    },

    async getSession(workspaceId: string, sessionId: string) {
      return requestSqlErdApiPayload<SqltoerdSessionPayload>(
        sessionPath(workspaceId, sessionId),
        { method: "GET" },
        requestOptions
      );
    },

    async listOperations(
      workspaceId: string,
      sessionId: string,
      afterSeq: number,
      signal?: AbortSignal
    ) {
      const searchParams = new URLSearchParams({
        afterSeq: String(Math.max(0, Math.trunc(afterSeq))),
        limit: "100"
      });
      const path = `${operationsPath(workspaceId, sessionId)}?${searchParams.toString()}` as const;

      return requestSqlErdApiPayload<SqlErdOperationListPayload>(
        path,
        { method: "GET", signal },
        requestOptions
      );
    },

    async createOperation(
      workspaceId: string,
      sessionId: string,
      payload: SqlErdCreateOperationRequest
    ) {
      return requestSqlErdApiPayload<SqlErdOperationWritePayload>(
        operationsPath(workspaceId, sessionId),
        { body: JSON.stringify(payload), method: "POST" },
        requestOptions
      );
    },

    async listSourceSnapshots(
      workspaceId: string,
      sessionId: string,
      ids: string[],
      signal?: AbortSignal
    ) {
      const path = `${sourceSnapshotsPath(workspaceId, sessionId)}?ids=${encodeURIComponent(ids.join(","))}` as const;

      return requestSqlErdApiPayload<SqlErdSourceSnapshotPayload[]>(
        path,
        { method: "GET", signal },
        requestOptions
      );
    },

    async acquireSourceLock(
      workspaceId: string,
      sessionId: string,
      leaseId: string
    ) {
      return requestSqlErdApiPayload<SqlErdSourceLockPayload>(
        sourceLockPath(workspaceId, sessionId),
        { body: JSON.stringify({ leaseId }), method: "POST" },
        requestOptions
      );
    },

    async renewSourceLock(
      workspaceId: string,
      sessionId: string,
      leaseId: string
    ) {
      return requestSqlErdApiPayload<SqlErdSourceLockPayload>(
        sourceLockPath(workspaceId, sessionId),
        { body: JSON.stringify({ leaseId }), method: "PATCH" },
        requestOptions
      );
    },

    async releaseSourceLock(
      workspaceId: string,
      sessionId: string,
      leaseId: string
    ) {
      return requestSqlErdApiPayload<null>(
        sourceLockPath(workspaceId, sessionId),
        { body: JSON.stringify({ leaseId }), method: "DELETE" },
        requestOptions
      );
    },

    async publishSourceSnapshot(
      workspaceId: string,
      sessionId: string,
      payload: SqlErdSourcePublishRequest
    ) {
      return requestSqlErdApiPayload<SqlErdSourcePublishPayload>(
        sourceSnapshotsPath(workspaceId, sessionId),
        { body: JSON.stringify(payload), method: "POST" },
        requestOptions
      );
    },

    async createSession(
      workspaceId: string,
      payload: CreateSqlErdSessionRequest
    ) {
      return requestSqlErdApiPayload<SqltoerdSessionPayload>(
        sessionsPath(workspaceId),
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
        sessionPath(workspaceId, sessionId),
        {
          body: JSON.stringify(payload),
          method: "PATCH"
        },
        requestOptions
      );
    },

    async deleteSession(
      workspaceId: string,
      sessionId: string,
      baseRevision: number
    ) {
      const path = `${sessionPath(workspaceId, sessionId)}?baseRevision=${encodeURIComponent(String(baseRevision))}` as const;

      return requestSqlErdApiPayload<SqltoerdSessionDeletePayload>(
        path,
        { method: "DELETE" },
        requestOptions
      );
    }
  };
}
