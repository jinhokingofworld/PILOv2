import type {
  CanvasShapeCommitAck,
  CanvasShapeCommitOperation,
  CanvasShapeCommitPayload,
  CanvasShapeLockState,
} from "./canvas-types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_URL = "http://localhost:4000";
const MAX_CANVAS_SHAPE_COMMIT_OPERATIONS = 100;

type CanvasShapeCommitServiceOptions = {
  appServerUrl?: string;
};

export type CanvasShapeCommitService = {
  commitOperations: (
    token: string,
    payload: CanvasShapeCommitPayload,
  ) => Promise<CanvasShapeCommitAck>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAppServerBaseUrl(appServerUrl?: string) {
  const trimmedUrl = (appServerUrl ?? DEFAULT_APP_SERVER_URL).trim().replace(/\/+$/, "");

  return trimmedUrl.endsWith(API_BASE_PATH)
    ? trimmedUrl
    : `${trimmedUrl}${API_BASE_PATH}`;
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalBaseRevision(value: unknown) {
  if (value === null || value === undefined) return null;

  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function normalizeCommitOperation(
  operation: unknown,
): CanvasShapeCommitOperation | null {
  if (!isRecord(operation)) return null;

  const type = operation.type;
  const shapeId = readRequiredString(operation, "shapeId");
  const clientOperationId = readRequiredString(operation, "clientOperationId");

  if (
    !shapeId ||
    !clientOperationId ||
    (type !== "create" && type !== "update" && type !== "delete")
  ) {
    return null;
  }

  if (type === "delete") {
    return {
      baseRevision: readOptionalBaseRevision(operation.baseRevision),
      clientOperationId,
      shapeId,
      type,
    };
  }

  if (!isRecord(operation.payload)) return null;

  return {
    baseRevision: readOptionalBaseRevision(operation.baseRevision),
    clientOperationId,
    payload: operation.payload,
    shapeId,
    type,
  };
}

export function readShapeCommitPayload(
  payload: unknown,
): CanvasShapeCommitPayload | null {
  if (!isRecord(payload)) return null;

  const workspaceId = readRequiredString(payload, "workspaceId");
  const canvasId = readRequiredString(payload, "canvasId");
  const operations = Array.isArray(payload.operations)
    ? payload.operations
    : null;

  if (
    !workspaceId ||
    !canvasId ||
    !operations ||
    operations.length > MAX_CANVAS_SHAPE_COMMIT_OPERATIONS
  ) {
    return null;
  }

  const normalizedOperations = operations.map(normalizeCommitOperation);

  if (normalizedOperations.some((operation) => operation === null)) {
    return null;
  }

  return {
    canvasId,
    operations: normalizedOperations as CanvasShapeCommitOperation[],
    workspaceId,
  };
}

export function getShapeCommitBlockedByLocks({
  locks,
  operations,
  ownerUserId,
}: {
  locks: CanvasShapeLockState[];
  operations: CanvasShapeCommitOperation[];
  ownerUserId: string;
}) {
  const operationShapeIds = new Set(
    operations
      .filter((operation) => operation.type !== "create")
      .map((operation) => operation.shapeId),
  );

  return locks.filter(
    (lock) =>
      lock.ownerUserId !== ownerUserId && operationShapeIds.has(lock.shapeId),
  );
}

export function createCanvasShapeCommitService({
  appServerUrl,
}: CanvasShapeCommitServiceOptions): CanvasShapeCommitService {
  const apiBaseUrl = normalizeAppServerBaseUrl(appServerUrl);

  return {
    async commitOperations(token, payload) {
      const path = `/workspaces/${encodeURIComponent(
        payload.workspaceId,
      )}/canvases/${encodeURIComponent(payload.canvasId)}/shapes/batch`;
      const response = await fetch(`${apiBaseUrl}${path}`, {
        body: JSON.stringify({ operations: payload.operations }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const responseBody = await readResponseJson(response);

      if (!response.ok) {
        return {
          error: {
            body: responseBody,
            code: "app_server_commit_failed",
            message: "Canvas shape commit failed",
            status: response.status,
          },
          ok: false,
        };
      }

      return {
        ok: true,
        result:
          isRecord(responseBody) && "data" in responseBody
            ? responseBody.data
            : responseBody,
      };
    },
  };
}

async function readResponseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
