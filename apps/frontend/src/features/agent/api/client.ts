import type {
  AgentConfirmationActionPayload,
  AgentRunDetailPayload,
  CreateAgentRunInput
} from "@/features/agent/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type AgentClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type AgentRequestOptions = {
  signal?: AbortSignal;
};

type AgentApiSuccessResponse<T> = {
  success: true;
  data: T;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultAgentApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getAgentApiBaseUrl(baseUrl = defaultAgentApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildAgentApiUrl(
  path: `/${string}`,
  baseUrl = defaultAgentApiBaseUrl()
) {
  return `${getAgentApiBaseUrl(baseUrl)}${path}`;
}

export class AgentApiError extends Error {
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
    this.name = "AgentApiError";
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

async function readAgentJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AgentApiError("Agent API returned invalid JSON", {
      status: response.status,
      path
    });
  }
}

function unwrapAgentData<T>(
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
    return (payload as AgentApiSuccessResponse<T>).data;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new AgentApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Agent API request failed",
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

  throw new AgentApiError("Agent API returned an unexpected response", {
    path,
    status
  });
}

function withJsonBody(body: unknown, init: RequestInit = {}) {
  return {
    ...init,
    body: JSON.stringify(body)
  };
}

async function requestAgentData<T>(
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

  const response = await fetcher(buildAgentApiUrl(path, baseUrl), {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readAgentJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new AgentApiError(apiError?.message ?? "Agent API request failed", {
      code: apiError?.code,
      path,
      status: response.status
    });
  }

  return unwrapAgentData<T>(payload, {
    path,
    status: response.status
  });
}

function agentRunsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/agent/runs` as const;
}

function agentRunPath(workspaceId: string, runId: string) {
  return `${agentRunsPath(workspaceId)}/${encodeURIComponent(runId)}` as const;
}

function agentConfirmationPath(
  workspaceId: string,
  runId: string,
  confirmationId: string,
  action: "approve" | "reject"
) {
  return `${agentRunPath(workspaceId, runId)}/confirmations/${encodeURIComponent(
    confirmationId
  )}/${action}` as const;
}

export function createAgentApiClient({
  accessToken = null,
  baseUrl = defaultAgentApiBaseUrl(),
  fetcher = fetch
}: AgentClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async createRun(
      workspaceId: string,
      body: CreateAgentRunInput,
      options: AgentRequestOptions = {}
    ) {
      return requestAgentData<AgentRunDetailPayload>(
        agentRunsPath(workspaceId),
        withJsonBody(body, {
          method: "POST",
          signal: options.signal
        }),
        requestOptions
      );
    },

    async getRun(
      workspaceId: string,
      runId: string,
      options: AgentRequestOptions = {}
    ) {
      return requestAgentData<AgentRunDetailPayload>(
        agentRunPath(workspaceId, runId),
        {
          method: "GET",
          signal: options.signal
        },
        requestOptions
      );
    },

    async approveConfirmation(
      workspaceId: string,
      runId: string,
      confirmationId: string,
      options: AgentRequestOptions = {}
    ) {
      return requestAgentData<AgentConfirmationActionPayload>(
        agentConfirmationPath(workspaceId, runId, confirmationId, "approve"),
        {
          method: "POST",
          signal: options.signal
        },
        requestOptions
      );
    },

    async rejectConfirmation(
      workspaceId: string,
      runId: string,
      confirmationId: string,
      options: AgentRequestOptions = {}
    ) {
      return requestAgentData<AgentConfirmationActionPayload>(
        agentConfirmationPath(workspaceId, runId, confirmationId, "reject"),
        {
          method: "POST",
          signal: options.signal
        },
        requestOptions
      );
    }
  };
}
