import type {
  ListPrReviewPullRequestsQuery,
  ListPrReviewRepositoriesQuery,
  PrReviewPaginatedPayload,
  PrReviewPullRequest,
  PrReviewPullRequestDetail,
  PrReviewPullRequestFile,
  PrReviewRepository,
  PrReviewSession
} from "@/features/pr-review/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type PrReviewClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type PrReviewApiSuccessResponse<T> = {
  success: true;
  data: T;
  meta?: PrReviewPaginatedPayload<unknown>["meta"];
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultPrReviewApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getPrReviewApiBaseUrl(baseUrl = defaultPrReviewApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildPrReviewApiUrl(
  path: `/${string}`,
  baseUrl = defaultPrReviewApiBaseUrl()
) {
  return `${getPrReviewApiBaseUrl(baseUrl)}${path}`;
}

export class PrReviewApiError extends Error {
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
    this.name = "PrReviewApiError";
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

async function readPrReviewJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new PrReviewApiError("PR Review API returned invalid JSON", {
      status: response.status,
      path
    });
  }
}

function unwrapPrReviewPayload<T>(
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
    return payload as PrReviewApiSuccessResponse<T>;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new PrReviewApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "PR Review API request failed",
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

  throw new PrReviewApiError("PR Review API returned an unexpected response", {
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

async function requestPrReviewPayload<T>(
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

  const response = await fetcher(buildPrReviewApiUrl(path, baseUrl), {
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readPrReviewJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new PrReviewApiError(
      apiError?.message ?? "PR Review API request failed",
      {
        code: apiError?.code,
        path,
        status: response.status
      }
    );
  }

  return unwrapPrReviewPayload<T>(payload, {
    path,
    status: response.status
  });
}

async function requestPrReviewData<T>(
  path: `/${string}`,
  init: RequestInit | undefined,
  requestOptions: {
    accessToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  }
) {
  const payload = await requestPrReviewPayload<T>(path, init, requestOptions);

  return payload.data;
}

async function requestPrReviewPage<T>(
  path: `/${string}`,
  init: RequestInit | undefined,
  requestOptions: {
    accessToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  }
): Promise<PrReviewPaginatedPayload<T>> {
  const payload = await requestPrReviewPayload<T[]>(path, init, requestOptions);

  if (!payload.meta) {
    throw new PrReviewApiError(
      "PR Review API returned a paginated response without meta",
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

function pullRequestGithubPath(workspaceId: string, pullRequestId: string) {
  return workspaceGithubPath(
    workspaceId,
    `/pull-requests/${encodeURIComponent(pullRequestId)}`
  );
}

export function createPrReviewApiClient({
  accessToken = null,
  baseUrl = defaultPrReviewApiBaseUrl(),
  fetcher = fetch
}: PrReviewClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async listRepositories(
      workspaceId: string,
      query: ListPrReviewRepositoriesQuery = {}
    ) {
      return requestPrReviewPage<PrReviewRepository>(
        withQueryParams(workspaceGithubPath(workspaceId, "/repositories"), query),
        undefined,
        requestOptions
      );
    },

    async listOpenPullRequests(
      workspaceId: string,
      repositoryId: string,
      query: Omit<ListPrReviewPullRequestsQuery, "state"> = {}
    ) {
      return requestPrReviewPage<PrReviewPullRequest>(
        withQueryParams(
          `${repositoryGithubPath(workspaceId, repositoryId)}/pull-requests`,
          {
            ...query,
            state: "open"
          }
        ),
        undefined,
        requestOptions
      );
    },

    async getPullRequest(workspaceId: string, pullRequestId: string) {
      return requestPrReviewData<PrReviewPullRequestDetail>(
        pullRequestGithubPath(workspaceId, pullRequestId),
        undefined,
        requestOptions
      );
    },

    async listPullRequestFiles(workspaceId: string, pullRequestId: string) {
      return requestPrReviewData<PrReviewPullRequestFile[]>(
        `${pullRequestGithubPath(workspaceId, pullRequestId)}/files`,
        undefined,
        requestOptions
      );
    },

    async createReviewSession(workspaceId: string, pullRequestId: string) {
      return requestPrReviewData<PrReviewSession>(
        `${pullRequestGithubPath(workspaceId, pullRequestId)}/review-sessions`,
        { method: "POST" },
        requestOptions
      );
    }
  };
}
