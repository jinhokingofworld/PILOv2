import { readCanvasStorage, writeCanvasStorage } from "../utils/canvas-storage";

type CanvasClientMode = "api" | "mock";

type CanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};

type CanvasViewportShapeQuery = {
  x: number;
  y: number;
  width: number;
  height: number;
  margin?: number;
};

type CanvasBoardDetail = {
  id: string;
  workspaceId: string;
  title: string;
  boardType: "freeform" | string;
  zoom: number;
  viewportX: number;
  viewportY: number;
  shapeCount: number;
  updatedAt: string;
  shapes: unknown[];
  viewSetting: CanvasViewSetting;
  userState: Record<string, unknown> | null;
};

type CanvasBoardSummary = Omit<CanvasBoardDetail, "shapes" | "viewSetting" | "userState">;

type CanvasClientOptions = {
  mode?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  authToken?: string | null;
};

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";
const DEFAULT_CANVAS_MODE = "api";
const defaultCanvasBoardId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const mockBoardListStorageScope = "mock-board-list";

function defaultCanvasMode() {
  return process.env.NEXT_PUBLIC_PILO_CANVAS_MODE ?? DEFAULT_CANVAS_MODE;
}

function defaultCanvasApiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    DEFAULT_APP_SERVER_ORIGIN
  );
}

function defaultCanvasAuthToken() {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_PILO_ACCESS_TOKEN ?? null;
  }

  return (
    window.localStorage.getItem("pilo:access-token") ??
    process.env.NEXT_PUBLIC_PILO_ACCESS_TOKEN ??
    null
  );
}

export function resolveCanvasClientMode(
  mode = defaultCanvasMode(),
): CanvasClientMode {
  return mode === "api" ? "api" : "mock";
}

export class CanvasApiError extends Error {
  status?: number;
  path?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      path?: string;
    } = {},
  ) {
    super(message);
    this.name = "CanvasApiError";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    throw new CanvasApiError("Canvas API request failed", {
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

function defaultCanvasViewSetting(): CanvasViewSetting {
  return {
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
  };
}

export function unwrapCanvasApiData(value: unknown) {
  if (isRecord(value) && value.success === true && "data" in value) {
    return value.data;
  }

  return value;
}

function normalizeCanvasShape(value: unknown) {
  return isRecord(value) && isRecord(value.rawShape) ? value.rawShape : value;
}

function normalizeCanvasShapes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeCanvasShape);
}

function buildViewportShapeQuery(query: CanvasViewportShapeQuery) {
  const searchParams = new URLSearchParams({
    x: String(query.x),
    y: String(query.y),
    width: String(query.width),
    height: String(query.height),
    margin: String(query.margin ?? 0),
  });

  return searchParams.toString();
}

export function createMockCanvasBoardDetail(
  workspaceId = "pilo-local-workspace",
): CanvasBoardDetail {
  return {
    id: defaultCanvasBoardId,
    workspaceId,
    title: "PILO Canvas",
    boardType: "freeform",
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
    shapeCount: 0,
    updatedAt: "2026-06-28T00:00:00.000Z",
    shapes: [],
    viewSetting: defaultCanvasViewSetting(),
    userState: null,
  };
}

function toBoardSummary(board: CanvasBoardDetail): CanvasBoardSummary {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    title: board.title,
    boardType: board.boardType,
    zoom: board.zoom,
    viewportX: board.viewportX,
    viewportY: board.viewportY,
    shapeCount: board.shapeCount,
    updatedAt: board.updatedAt,
  };
}

function readMockBoards(workspaceId: string): CanvasBoardDetail[] {
  const boards = readCanvasStorage(mockBoardListStorageScope, workspaceId);

  return Array.isArray(boards)
    ? boards.filter(isRecord).map((board) =>
        normalizeCanvasBoardDetail(board, { workspaceId }),
      )
    : [];
}

function writeMockBoards(workspaceId: string, boards: CanvasBoardDetail[]) {
  writeCanvasStorage(mockBoardListStorageScope, workspaceId, boards);
}

function createMockBlankBoard(
  workspaceId: string,
  title: unknown,
): CanvasBoardDetail {
  const now = new Date().toISOString();
  const normalizedTitle = typeof title === "string" ? title.trim() : "";

  return {
    id: `local-canvas-board-${Date.now()}`,
    workspaceId,
    title: normalizedTitle || "Untitled canvas",
    boardType: "freeform",
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
    shapeCount: 0,
    updatedAt: now,
    shapes: [],
    viewSetting: defaultCanvasViewSetting(),
    userState: null,
  };
}

export function normalizeCanvasBoardDetail(
  rawBoard: unknown,
  { workspaceId }: { workspaceId?: string } = {},
): CanvasBoardDetail {
  if (!isRecord(rawBoard)) {
    return createMockCanvasBoardDetail(workspaceId);
  }

  const fallback = createMockCanvasBoardDetail(
    workspaceId ??
      (typeof rawBoard.workspaceId === "string" ? rawBoard.workspaceId : undefined),
  );
  const rawViewSetting = rawBoard.viewSetting;

  return {
    ...fallback,
    id: typeof rawBoard.id === "string" ? rawBoard.id : fallback.id,
    workspaceId:
      typeof rawBoard.workspaceId === "string"
        ? rawBoard.workspaceId
        : fallback.workspaceId,
    title: typeof rawBoard.title === "string" ? rawBoard.title : fallback.title,
    boardType:
      typeof rawBoard.boardType === "string"
        ? rawBoard.boardType
        : fallback.boardType,
    zoom: typeof rawBoard.zoom === "number" ? rawBoard.zoom : fallback.zoom,
    viewportX:
      typeof rawBoard.viewportX === "number"
        ? rawBoard.viewportX
        : fallback.viewportX,
    viewportY:
      typeof rawBoard.viewportY === "number"
        ? rawBoard.viewportY
        : fallback.viewportY,
    shapeCount:
      typeof rawBoard.shapeCount === "number"
        ? rawBoard.shapeCount
        : fallback.shapeCount,
    updatedAt:
      typeof rawBoard.updatedAt === "string"
        ? rawBoard.updatedAt
        : fallback.updatedAt,
    shapes: normalizeCanvasShapes(rawBoard.shapes),
    viewSetting: isRecord(rawViewSetting)
      ? {
          zoom:
            typeof rawViewSetting.zoom === "number"
              ? rawViewSetting.zoom
              : fallback.viewSetting.zoom,
          viewportX:
            typeof rawViewSetting.viewportX === "number"
              ? rawViewSetting.viewportX
              : fallback.viewSetting.viewportX,
          viewportY:
            typeof rawViewSetting.viewportY === "number"
              ? rawViewSetting.viewportY
              : fallback.viewSetting.viewportY,
        }
      : fallback.viewSetting,
    userState: isRecord(rawBoard.userState) ? rawBoard.userState : null,
  };
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
      { workspaceId }: { workspaceId: string },
    ) {
      const search = buildViewportShapeQuery(query);
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvases/${encodeURIComponent(boardId)}/shapes?${search}`;
      const shapes = await requestCanvasJson(path, undefined, requestOptions);

      return normalizeCanvasShapes(shapes);
    },

    async getShapeDetail(shapeId: string, { workspaceId }: { workspaceId: string }) {
      const path = `/workspaces/${encodeURIComponent(workspaceId)}/canvas-shapes/${encodeURIComponent(shapeId)}`;
      const shape = await requestCanvasJson(path, undefined, requestOptions);

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

    async deleteShape(shapeId: string, { workspaceId }: { workspaceId: string }) {
      return requestCanvasJson(
        `/workspaces/${encodeURIComponent(workspaceId)}/canvas-shapes/${encodeURIComponent(shapeId)}`,
        { method: "DELETE" },
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

export function createMockCanvasClient() {
  return {
    async listBoards(workspaceId: string) {
      return [
        toBoardSummary(createMockCanvasBoardDetail(workspaceId)),
        ...readMockBoards(workspaceId).map(toBoardSummary),
      ];
    },

    async createBoard(
      workspaceId: string,
      body: {
        title?: string;
      } = {},
    ) {
      const boards = readMockBoards(workspaceId);
      const board = createMockBlankBoard(workspaceId, body.title);

      writeMockBoards(workspaceId, [board, ...boards]);

      return toBoardSummary(board);
    },

    async getBoardDetail(
      boardId: string,
      { workspaceId }: { workspaceId?: string } = {},
    ) {
      const defaultBoard = createMockCanvasBoardDetail(workspaceId);

      if (!boardId || boardId === defaultBoard.id) {
        return defaultBoard;
      }

      const storedBoard = readMockBoards(defaultBoard.workspaceId).find(
        (board) => board.id === boardId,
      );

      if (storedBoard) {
        return normalizeCanvasBoardDetail(storedBoard, {
          workspaceId: defaultBoard.workspaceId,
        });
      }

      return {
        ...createMockBlankBoard(defaultBoard.workspaceId, "Untitled canvas"),
        id: boardId,
      };
    },

    async listShapesInViewport(
      boardId: string,
      _query: CanvasViewportShapeQuery,
      { workspaceId }: { workspaceId?: string } = {},
    ) {
      const defaultBoard = createMockCanvasBoardDetail(workspaceId);
      const storedBoard = readMockBoards(defaultBoard.workspaceId).find(
        (board) => board.id === boardId,
      );
      const board =
        !boardId || boardId === defaultBoard.id
          ? defaultBoard
          : storedBoard ?? {
              ...createMockBlankBoard(defaultBoard.workspaceId, "Untitled canvas"),
              id: boardId,
            };

      return normalizeCanvasShapes(board.shapes);
    },

    async getShapeDetail(shapeId: string, { workspaceId }: { workspaceId?: string } = {}) {
      const defaultBoard = createMockCanvasBoardDetail(workspaceId);
      const boards = [
        defaultBoard,
        ...readMockBoards(defaultBoard.workspaceId),
      ];
      const shape = boards
        .flatMap((board) => normalizeCanvasShapes(board.shapes))
        .find((rawShape) => isRecord(rawShape) && rawShape.id === shapeId);

      return shape ?? null;
    },

    async enterCanvas(boardId: string, { workspaceId }: { workspaceId?: string } = {}) {
      const now = new Date().toISOString();

      return {
        canvasId: boardId,
        userId: "mock-user",
        enteredAt: now,
        leftAt: null,
        workspaceId,
      };
    },

    async leaveCanvas(boardId: string, { workspaceId }: { workspaceId?: string } = {}) {
      const now = new Date().toISOString();

      return {
        canvasId: boardId,
        userId: "mock-user",
        enteredAt: now,
        leftAt: now,
        permanentlyDeletedShapeCount: 0,
        workspaceId,
      };
    },

    async syncShapesBatch(_boardId: string, body: unknown) {
      const operations =
        isRecord(body) && Array.isArray(body.operations) ? body.operations : [];

      return {
        created: operations.filter(
          (operation) => isRecord(operation) && operation.type === "create",
        ).length,
        updated: operations.filter(
          (operation) => isRecord(operation) && operation.type === "update",
        ).length,
        deleted: operations.filter(
          (operation) => isRecord(operation) && operation.type === "delete",
        ).length,
      };
    },

    async createShape(boardId: string, body: Record<string, unknown>) {
      const now = new Date().toISOString();

      return {
        id: body.id ?? "mock-canvas-shape-created",
        canvasId: boardId,
        shapeType: body.shapeType,
        title: body.title ?? null,
        textContent: body.textContent ?? null,
        x: body.x ?? 0,
        y: body.y ?? 0,
        width: body.width ?? null,
        height: body.height ?? null,
        rotation: body.rotation ?? 0,
        zIndex: body.zIndex ?? 1,
        rawShape: body.rawShape ?? {},
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    },

    async updateShape(shapeId: string, body: Record<string, unknown>) {
      return {
        id: shapeId,
        ...body,
      };
    },

    async deleteShape(shapeId: string) {
      return {
        id: shapeId,
        deleted: true,
      };
    },

    async updateViewSetting(_boardId: string, body: unknown) {
      return body;
    },
  };
}

export function createCanvasClient(options: CanvasClientOptions = {}) {
  const mode = resolveCanvasClientMode(options.mode);

  if (mode === "api") {
    return createCanvasApiClient(options);
  }

  return createMockCanvasClient();
}
