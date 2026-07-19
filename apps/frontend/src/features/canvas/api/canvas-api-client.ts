import type {
  CanvasClientOptions,
  CanvasViewportShapeQuery,
  CanvasWorkspaceRequestOptions,
} from "./canvas-types";
import {
  normalizeCanvasBoardDetail,
  normalizeCanvasOperationsCatchup,
  normalizeCanvasShape,
  normalizeCanvasShapes,
  unwrapCanvasApiData,
} from "./canvas-normalizers";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

function defaultCanvasApiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_APP_SERVER_ORIGIN
  );
}

function defaultCanvasAuthToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("pilo:access-token");
}

export class CanvasApiError extends Error {
  body?: unknown;
  status?: number;
  path?: string;

  constructor(
    message: string,
    options: {
      body?: unknown;
      status?: number;
      path?: string;
    } = {},
  ) {
    super(message);
    this.name = "CanvasApiError";
    this.body = options.body;
    this.status = options.status;
    this.path = options.path;
  }
}

export function buildCanvasApiUrl(
  path: string,
  baseUrl = defaultCanvasApiBaseUrl(),
) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const apiBaseUrl = normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;

  return `${apiBaseUrl}${normalizedPath}`;
}

async function readCanvasJson(response: Response, path: string) {
  if (response.status === 204) {
    return null;
  }

  try {
    return unwrapCanvasApiData((await response.json()) as unknown);
  } catch (error) {
    throw new CanvasApiError("Canvas API returned invalid JSON", {
      status: response.status,
      path,
    });
  }
}

async function readCanvasErrorBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function requestCanvasJson(
  path: string,
  init: RequestInit | undefined,
  {
    authToken,
    baseUrl,
    fetcher,
  }: {
    authToken: string | null;
    baseUrl: string;
    fetcher: typeof fetch;
  },
) {
  const headers = {
    Accept: "application/json",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(init?.headers ?? {}),
  };

  const response = await fetcher(buildCanvasApiUrl(path, baseUrl), {
    ...init,
    credentials: "same-origin",
    headers,
  });

  if (!response.ok) {
    const body = await readCanvasErrorBody(response);

    throw new CanvasApiError("Canvas API request failed", {
      body,
      status: response.status,
      path,
    });
  }

  return readCanvasJson(response, path);
}

function withJsonBody(body: unknown, init: RequestInit = {}) {
  return {
    ...init,
    body: JSON.stringify(body),
  };
}

function buildViewportShapeQuery(query: CanvasViewportShapeQuery) {
  const searchParams = new URLSearchParams();

  if (typeof query.parentShapeId === "string" && query.parentShapeId) {
    searchParams.set("parentShapeId", query.parentShapeId);
  }

  if (typeof query.x === "number") {
    searchParams.set("x", String(query.x));
  }

  if (typeof query.y === "number") {
    searchParams.set("y", String(query.y));
  }

  if (typeof query.width === "number") {
    searchParams.set("width", String(query.width));
  }

  if (typeof query.height === "number") {
    searchParams.set("height", String(query.height));
  }

  if (typeof query.margin === "number") {
    searchParams.set("margin", String(query.margin));
  }

  return searchParams.toString();
}

export function createCanvasApiClient({
  authToken = defaultCanvasAuthToken(),
  baseUrl = defaultCanvasApiBaseUrl(),
  fetcher = fetch,
}: CanvasClientOptions = {}) {
  const requestOptions = { authToken, baseUrl, fetcher };

  return {
    async listBoards(workspaceId: string) {
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvases`;
      const boards = await requestCanvasJson(path, undefined, requestOptions);

      return Array.isArray(boards) ? boards : [];
    },

    async createBoard(workspaceId: string, body: unknown) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvases`,
        withJsonBody(body, { method: "POST" }),
        requestOptions,
      );
    },

    async getBoardDetail(boardId: string, { workspaceId }: { workspaceId: string }) {
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}`;
      const board = await requestCanvasJson(path, undefined, requestOptions);

      return normalizeCanvasBoardDetail(board, { workspaceId });
    },

    async listShapesInViewport(
      boardId: string,
      query: CanvasViewportShapeQuery,
      { signal, workspaceId }: CanvasWorkspaceRequestOptions,
    ) {
      const search = buildViewportShapeQuery(query);
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/shapes?${search}`;
      const shapes = await requestCanvasJson(path, { signal }, requestOptions);

      return normalizeCanvasShapes(shapes);
    },

    async listOperationsAfterSeq(
      boardId: string,
      afterSeq: number,
      { signal, workspaceId }: CanvasWorkspaceRequestOptions,
    ) {
      const search = new URLSearchParams({
        afterSeq: String(Math.max(0, Math.trunc(afterSeq))),
      });
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/operations?${search.toString()}`;
      const operations = await requestCanvasJson(path, { signal }, requestOptions);

      return normalizeCanvasOperationsCatchup(operations);
    },

    async getShapeDetail(
      shapeId: string,
      { signal, workspaceId }: CanvasWorkspaceRequestOptions,
    ) {
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvas-shapes/${encodeURIComponent(shapeId)}`;
      const shape = await requestCanvasJson(path, { signal }, requestOptions);

      return normalizeCanvasShape(shape);
    },

    async enterCanvas(boardId: string, { workspaceId }: { workspaceId: string }) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/enter`,
        { method: "POST" },
        requestOptions,
      );
    },

    async leaveCanvas(boardId: string, { workspaceId }: { workspaceId: string }) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/leave`,
        { method: "PATCH" },
        requestOptions,
      );
    },

    async syncShapesBatch(
      boardId: string,
      body: unknown,
      { workspaceId }: { workspaceId: string },
    ) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/shapes/batch`,
        withJsonBody(body, { method: "POST" }),
        requestOptions,
      );
    },

    async createShape(
      boardId: string,
      body: unknown,
      { workspaceId }: { workspaceId: string },
    ) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/shapes`,
        withJsonBody(body, { method: "POST" }),
        requestOptions,
      );
    },

    async updateShape(
      shapeId: string,
      body: unknown,
      { workspaceId }: { workspaceId: string },
    ) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvas-shapes/${encodeURIComponent(shapeId)}`,
        withJsonBody(body, { method: "PATCH" }),
        requestOptions,
      );
    },

    async deleteShape(
      shapeId: string,
      body: unknown,
      { workspaceId }: { workspaceId: string },
    ) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvas-shapes/${encodeURIComponent(shapeId)}`,
        withJsonBody(body, { method: "DELETE" }),
        requestOptions,
      );
    },

    async updateViewSetting(
      boardId: string,
      body: unknown,
      { workspaceId }: { workspaceId: string },
    ) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/view-settings`,
        withJsonBody(body, { method: "PUT" }),
        requestOptions,
      );
    },
  };
}
