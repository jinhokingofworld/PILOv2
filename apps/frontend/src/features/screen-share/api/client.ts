import type {
  LiveKitJoin,
  PublicScreenShareSession,
  StartScreenSharePayload
} from "../types.ts";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type ScreenShareApiClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export type ScreenShareApiClient = {
  getCurrent(
    workspaceId: string
  ): Promise<{ session: PublicScreenShareSession | null }>;
  start(workspaceId: string): Promise<StartScreenSharePayload>;
  createViewerToken(
    workspaceId: string,
    sessionId: string
  ): Promise<LiveKitJoin>;
  end(
    workspaceId: string,
    sessionId: string
  ): Promise<{ sessionId: string; ended: true }>;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function defaultApiBaseUrl() {
  const origin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );
  return origin.endsWith(API_BASE_PATH) ? origin : `${origin}${API_BASE_PATH}`;
}

function getApiBaseUrl(baseUrl: string) {
  const normalized = trimTrailingSlash(baseUrl);
  return normalized.endsWith(API_BASE_PATH)
    ? normalized
    : `${normalized}${API_BASE_PATH}`;
}

export class ScreenShareApiError extends Error {
  status?: number;
  path?: string;
  code?: string;

  constructor(
    message: string,
    options: { status?: number; path?: string; code?: string } = {}
  ) {
    super(message);
    this.name = "ScreenShareApiError";
    this.status = options.status;
    this.path = options.path;
    this.code = options.code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readApiError(payload: unknown) {
  if (
    !isRecord(payload) ||
    payload.success !== false ||
    !isRecord(payload.error)
  ) {
    return null;
  }

  return {
    code:
      typeof payload.error.code === "string" ? payload.error.code : undefined,
    message:
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Screen share API request failed"
  };
}

async function requestData<T>(
  path: `/${string}`,
  method: "GET" | "POST" | "DELETE",
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
  const headers = new Headers({ Accept: "application/json" });
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetcher(`${getApiBaseUrl(baseUrl)}${path}`, {
    credentials: "same-origin",
    headers,
    method
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ScreenShareApiError("Screen share API returned invalid JSON", {
      path,
      status: response.status
    });
  }

  if (!response.ok) {
    const apiError = readApiError(payload);
    throw new ScreenShareApiError(
      apiError?.message ?? "Screen share API request failed",
      {
        code: apiError?.code,
        path,
        status: response.status
      }
    );
  }

  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !Object.hasOwn(payload, "data")
  ) {
    throw new ScreenShareApiError(
      "Screen share API returned an unexpected response",
      { path, status: response.status }
    );
  }

  return (payload as ApiSuccessResponse<T>).data;
}

function sessionsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/screen-share-sessions` as const;
}

function sessionPath(workspaceId: string, sessionId: string) {
  return `${sessionsPath(workspaceId)}/${encodeURIComponent(sessionId)}` as const;
}

export function createScreenShareApiClient({
  accessToken = null,
  baseUrl = defaultApiBaseUrl(),
  fetcher = fetch
}: ScreenShareApiClientOptions = {}): ScreenShareApiClient {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    getCurrent(workspaceId) {
      return requestData<{ session: PublicScreenShareSession | null }>(
        `${sessionsPath(workspaceId)}/current`,
        "GET",
        requestOptions
      );
    },

    start(workspaceId) {
      return requestData<StartScreenSharePayload>(
        sessionsPath(workspaceId),
        "POST",
        requestOptions
      );
    },

    createViewerToken(workspaceId, sessionId) {
      return requestData<LiveKitJoin>(
        `${sessionPath(workspaceId, sessionId)}/viewer-token`,
        "POST",
        requestOptions
      );
    },

    end(workspaceId, sessionId) {
      return requestData<{ sessionId: string; ended: true }>(
        sessionPath(workspaceId, sessionId),
        "DELETE",
        requestOptions
      );
    }
  };
}
