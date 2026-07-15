import { readCanvasStorage, writeCanvasStorage } from "../utils/canvas-storage";
import type {
  CanvasBoardDetail,
  CanvasOperationsCatchupPayload,
  CanvasViewportShapeQuery,
  CanvasWorkspaceRequestOptions,
} from "./canvas-types";
import {
  createMockCanvasBoardDetail,
  defaultCanvasViewSetting,
  isRecord,
  normalizeCanvasBoardDetail,
  normalizeCanvasSyncDocument,
  normalizeCanvasShapes,
  toBoardSummary,
} from "./canvas-normalizers";

const mockBoardListStorageScope = "mock-board-list";
const mockSyncDocumentStorageScope = "mock-sync-documents";

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

function readMockSyncDocuments(workspaceId: string) {
  const documents = readCanvasStorage(mockSyncDocumentStorageScope, workspaceId);

  return isRecord(documents) ? documents : {};
}

function writeMockSyncDocuments(
  workspaceId: string,
  documents: Record<string, unknown>,
) {
  writeCanvasStorage(mockSyncDocumentStorageScope, workspaceId, documents);
}

function createMockBlankBoard(
  workspaceId: string,
  title: unknown,
  engineType = "classic",
): CanvasBoardDetail {
  const now = new Date().toISOString();
  const normalizedTitle = typeof title === "string" ? title.trim() : "";

  return {
    id: `local-canvas-board-${Date.now()}`,
    workspaceId,
    title: normalizedTitle || "Untitled canvas",
    boardType: "freeform",
    engineType,
    engineVersion: 1,
    sourceCanvasId: null,
    zoom: 0.8,
    viewportX: 0,
    viewportY: 0,
    shapeCount: 0,
    updatedAt: now,
    shapes: [],
    viewSetting: defaultCanvasViewSetting(),
    userState: null,
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
        engineType?: string;
        title?: string;
      } = {},
    ) {
      const boards = readMockBoards(workspaceId);
      const board = createMockBlankBoard(
        workspaceId,
        body.title,
        body.engineType,
      );

      writeMockBoards(workspaceId, [board, ...boards]);

      return toBoardSummary(board);
    },

    async convertBoardEngine(
      boardId: string,
      body: { copyShapes?: boolean; targetEngineType?: string } = {},
      { workspaceId }: { workspaceId?: string } = {},
    ) {
      const defaultBoard = createMockCanvasBoardDetail(workspaceId);
      const boards = readMockBoards(defaultBoard.workspaceId);
      const sourceBoard =
        boards.find((board) => board.id === boardId) ?? defaultBoard;
      const targetEngineType = body.targetEngineType ?? "tldraw_sync";
      const convertedBoard = {
        ...createMockBlankBoard(
          defaultBoard.workspaceId,
          `${sourceBoard.title} 실시간`,
          targetEngineType,
        ),
        sourceCanvasId: sourceBoard.id,
      };

      writeMockBoards(defaultBoard.workspaceId, [convertedBoard, ...boards]);

      return toBoardSummary(convertedBoard);
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

    async getSyncDocument(
      boardId: string,
      { workspaceId }: { workspaceId?: string } = {},
    ) {
      const defaultBoard = createMockCanvasBoardDetail(workspaceId);
      const documents = readMockSyncDocuments(defaultBoard.workspaceId);

      return normalizeCanvasSyncDocument(documents[boardId], {
        boardId,
        workspaceId: defaultBoard.workspaceId,
      });
    },

    async updateSyncDocument(
      boardId: string,
      body: { snapshot?: Record<string, unknown> | null } = {},
      { workspaceId }: { workspaceId?: string } = {},
    ) {
      const defaultBoard = createMockCanvasBoardDetail(workspaceId);
      const documents = readMockSyncDocuments(defaultBoard.workspaceId);
      const previous = normalizeCanvasSyncDocument(documents[boardId], {
        boardId,
        workspaceId: defaultBoard.workspaceId,
      });
      const document = {
        canvasId: boardId,
        providerType: "tldraw_sync",
        snapshot: isRecord(body.snapshot) ? body.snapshot : null,
        updatedAt: new Date().toISOString(),
        version: previous.version + 1,
        workspaceId: defaultBoard.workspaceId,
      };

      writeMockSyncDocuments(defaultBoard.workspaceId, {
        ...documents,
        [boardId]: document,
      });

      return document;
    },

    async listShapesInViewport(
      boardId: string,
      query: CanvasViewportShapeQuery,
      { workspaceId }: Partial<CanvasWorkspaceRequestOptions> = {},
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

      const shapes = normalizeCanvasShapes(board.shapes);

      if (typeof query.parentShapeId === "string" && query.parentShapeId) {
        return shapes.filter(
          (shape) => isRecord(shape) && shape.parentId === query.parentShapeId,
        );
      }

      return shapes.filter((shape) => !isRecord(shape) || !shape.parentId);
    },

    async getShapeDetail(
      shapeId: string,
      { workspaceId }: Partial<CanvasWorkspaceRequestOptions> = {},
    ) {
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

    async listOperationsAfterSeq(
      _boardId: string,
      afterSeq = 0,
    ): Promise<CanvasOperationsCatchupPayload> {
      return {
        latestOpSeq: Math.max(0, Math.trunc(afterSeq)),
        operations: [],
      };
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
      const changedShapes = operations.flatMap((operation) => {
        if (
          !isRecord(operation) ||
          (operation.type !== "create" && operation.type !== "update") ||
          !isRecord(operation.payload)
        ) {
          return [];
        }

        return [
          {
            ...operation.payload,
            contentHash: `mock-${String(operation.shapeId)}-content`,
            revision: 1,
          },
        ];
      });
      const deletedShapes = operations.flatMap((operation) => {
        if (!isRecord(operation) || operation.type !== "delete") {
          return [];
        }

        return [
          {
            id: operation.shapeId,
            deleted: true,
            deletedAt: new Date().toISOString(),
            contentHash: `mock-${String(operation.shapeId)}-content`,
            revision: 1,
          },
        ];
      });

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
        shapes: changedShapes,
        deletedShapes,
      };
    },

    async createShape(boardId: string, body: Record<string, unknown>) {
      const now = new Date().toISOString();

      return {
        id: body.id ?? "mock-canvas-shape-created",
        canvasId: boardId,
        parentShapeId: body.parentShapeId ?? null,
        shapeType: body.shapeType,
        title: body.title ?? null,
        textContent: body.textContent ?? null,
        x: body.x ?? 0,
        y: body.y ?? 0,
        width: body.width ?? null,
        height: body.height ?? null,
        rotation: body.rotation ?? 0,
        zIndex: body.zIndex ?? 1,
        childShapeCount: 0,
        rawShape: body.rawShape ?? {},
        contentHash: `mock-${String(body.id ?? "created")}-content`,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    },

    async updateShape(shapeId: string, body: Record<string, unknown>) {
      return {
        id: shapeId,
        ...body,
        contentHash: `mock-${shapeId}-content`,
        revision: 1,
      };
    },

    async deleteShape(shapeId: string, _body?: unknown) {
      return {
        id: shapeId,
        deleted: true,
        deletedAt: new Date().toISOString(),
        contentHash: `mock-${shapeId}-content`,
        revision: 1,
      };
    },

    async updateViewSetting(_boardId: string, body: unknown) {
      return body;
    },
  };
}
