import type {
  GithubAppInstallation,
  GithubAppInstallationStart,
  GithubOAuthDisconnect,
  GithubOAuthStart,
  GithubOAuthStatus,
  GithubPaginatedPayload,
  GithubPaginationMeta,
  GithubProjectV2,
  GithubPullRequest,
  GithubRepository,
  GithubSyncRun,
  ListGithubProjectsV2Query,
  ListGithubPullRequestsQuery,
  ListGithubRepositoriesQuery,
  ListGithubSyncRunsQuery,
  StartGithubAppInstallationInput,
  StartGithubOAuthInput,
  StartGithubSyncRunInput
} from "@/features/github-integration/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type GithubIntegrationClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type GithubIntegrationApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: GithubPaginationMeta;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultGithubIntegrationApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getGithubIntegrationApiBaseUrl(
  baseUrl = defaultGithubIntegrationApiBaseUrl()
) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildGithubIntegrationApiUrl(
  path: `/${string}`,
  baseUrl = defaultGithubIntegrationApiBaseUrl()
) {
  return `${getGithubIntegrationApiBaseUrl(baseUrl)}${path}`;
}

export class GithubIntegrationApiError extends Error {
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
    this.name = "GithubIntegrationApiError";
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

async function readGithubIntegrationJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GithubIntegrationApiError(
      "GitHub Integration API returned invalid JSON",
      {
        status: response.status,
        path
      }
    );
  }
}

function unwrapGithubIntegrationPayload<T>(
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
    return payload as GithubIntegrationApiSuccessResponse<T>;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new GithubIntegrationApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "GitHub Integration API request failed",
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

  throw new GithubIntegrationApiError(
    "GitHub Integration API returned an unexpected response",
    {
      path,
      status
    }
  );
}

function withJsonBody(body: unknown, init: RequestInit = {}) {
  return {
    ...init,
    body: JSON.stringify(body)
  };
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

function withQueryParams(
  path: `/${string}`,
  query: object = {}
) {
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

async function requestGithubIntegrationPayload<T>(
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

  const response = await fetcher(buildGithubIntegrationApiUrl(path, baseUrl), {
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readGithubIntegrationJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new GithubIntegrationApiError(
      apiError?.message ?? "GitHub Integration API request failed",
      {
        code: apiError?.code,
        path,
        status: response.status
      }
    );
  }

  return unwrapGithubIntegrationPayload<T>(payload, {
    path,
    status: response.status
  });
}

async function requestGithubIntegrationData<T>(
  path: `/${string}`,
  init: RequestInit | undefined,
  requestOptions: {
    accessToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  }
) {
  const payload = await requestGithubIntegrationPayload<T>(
    path,
    init,
    requestOptions
  );

  return payload.data;
}

async function requestGithubIntegrationPage<T>(
  path: `/${string}`,
  init: RequestInit | undefined,
  requestOptions: {
    accessToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  }
): Promise<GithubPaginatedPayload<T>> {
  const payload = await requestGithubIntegrationPayload<T[]>(
    path,
    init,
    requestOptions
  );

  if (!payload.meta) {
    throw new GithubIntegrationApiError(
      "GitHub Integration API returned a paginated response without meta",
      {
        path
      }
    );
  }

  return {
    data: payload.data,
    meta: payload.meta
  };
}

function workspaceGithubPath(workspaceId: string, path: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/github${path}` as const;
}

function repositoryGithubPath(workspaceId: string, repositoryId: string) {
  return workspaceGithubPath(
    workspaceId,
    `/repositories/${encodeURIComponent(repositoryId)}`
  );
}

function projectV2GithubPath(workspaceId: string, projectV2Id: string) {
  return workspaceGithubPath(
    workspaceId,
    `/projects-v2/${encodeURIComponent(projectV2Id)}`
  );
}

export function createGithubIntegrationApiClient({
  accessToken = null,
  baseUrl = defaultGithubIntegrationApiBaseUrl(),
  fetcher = fetch
}: GithubIntegrationClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async getGithubOAuthStatus() {
      return requestGithubIntegrationData<GithubOAuthStatus>(
        "/me/github",
        undefined,
        requestOptions
      );
    },

    async startGithubOAuth(body: StartGithubOAuthInput = {}) {
      return requestGithubIntegrationData<GithubOAuthStart>(
        "/me/github/oauth/start",
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async disconnectGithubOAuth() {
      return requestGithubIntegrationData<GithubOAuthDisconnect>(
        "/me/github",
        { method: "DELETE" },
        requestOptions
      );
    },

    async startGithubAppInstallation(
      workspaceId: string,
      body: StartGithubAppInstallationInput = {}
    ) {
      return requestGithubIntegrationData<GithubAppInstallationStart>(
        workspaceGithubPath(workspaceId, "/installations/start"),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async listGithubAppInstallations(workspaceId: string) {
      return requestGithubIntegrationData<GithubAppInstallation[]>(
        workspaceGithubPath(workspaceId, "/installations"),
        undefined,
        requestOptions
      );
    },

    async listGithubRepositories(
      workspaceId: string,
      query: ListGithubRepositoriesQuery = {}
    ) {
      return requestGithubIntegrationPage<GithubRepository>(
        withQueryParams(workspaceGithubPath(workspaceId, "/repositories"), query),
        undefined,
        requestOptions
      );
    },

    async getGithubRepository(workspaceId: string, repositoryId: string) {
      return requestGithubIntegrationData<GithubRepository>(
        repositoryGithubPath(workspaceId, repositoryId),
        undefined,
        requestOptions
      );
    },

    async listGithubPullRequests(
      workspaceId: string,
      repositoryId: string,
      query: ListGithubPullRequestsQuery = {}
    ) {
      return requestGithubIntegrationPage<GithubPullRequest>(
        withQueryParams(
          `${repositoryGithubPath(workspaceId, repositoryId)}/pull-requests`,
          query
        ),
        undefined,
        requestOptions
      );
    },

    async listGithubProjectsV2(
      workspaceId: string,
      query: ListGithubProjectsV2Query = {}
    ) {
      return requestGithubIntegrationPage<GithubProjectV2>(
        withQueryParams(workspaceGithubPath(workspaceId, "/projects-v2"), query),
        undefined,
        requestOptions
      );
    },

    async getGithubProjectV2(workspaceId: string, projectV2Id: string) {
      return requestGithubIntegrationData<GithubProjectV2>(
        projectV2GithubPath(workspaceId, projectV2Id),
        undefined,
        requestOptions
      );
    },

    async startGithubSyncRun(
      workspaceId: string,
      body: StartGithubSyncRunInput
    ) {
      return requestGithubIntegrationData<GithubSyncRun>(
        workspaceGithubPath(workspaceId, "/sync-runs"),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async listGithubSyncRuns(
      workspaceId: string,
      query: ListGithubSyncRunsQuery = {}
    ) {
      return requestGithubIntegrationPage<GithubSyncRun>(
        withQueryParams(workspaceGithubPath(workspaceId, "/sync-runs"), query),
        undefined,
        requestOptions
      );
    }
  };
}
