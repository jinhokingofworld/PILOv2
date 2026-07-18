import { buildCanvasApiUrl } from "../../api/canvas-api-client";

type CanvasDriveItem = {
  id: string;
  itemType: "folder" | "file" | "document";
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadStatus: "pending" | "ready" | "failed" | null;
};

export type CanvasDriveListPayload = {
  parent: CanvasDriveItem | null;
  breadcrumbs: CanvasDriveItem[];
  items: CanvasDriveItem[];
};

export type CanvasDrivePreviewPayload = {
  file: CanvasDriveItem;
  previewUrl: string;
  expiresAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requestCanvasDriveData<T>({
  accessToken,
  path,
  signal,
}: {
  accessToken: string;
  path: string;
  signal?: AbortSignal;
}): Promise<T> {
  const response = await fetch(buildCanvasApiUrl(path), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  });
  const payload = (await response.json()) as unknown;

  if (
    response.ok &&
    isRecord(payload) &&
    payload.success === true &&
    Object.hasOwn(payload, "data")
  ) {
    return payload.data as T;
  }

  const message =
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
      ? payload.error.message
      : "Drive 파일을 불러오지 못했습니다.";

  throw new Error(message);
}

export function listCanvasDriveItems({
  accessToken,
  folderId,
  signal,
  workspaceId,
}: {
  accessToken: string;
  folderId: string | null;
  signal?: AbortSignal;
  workspaceId: string;
}) {
  const search = folderId
    ? `?parentId=${encodeURIComponent(folderId)}`
    : "";

  return requestCanvasDriveData<CanvasDriveListPayload>({
    accessToken,
    path: `/workspaces/${encodeURIComponent(workspaceId)}/drive/items${search}`,
    signal,
  });
}

export function createCanvasDrivePreviewUrl({
  accessToken,
  fileId,
  signal,
  workspaceId,
}: {
  accessToken: string;
  fileId: string;
  signal?: AbortSignal;
  workspaceId: string;
}) {
  return requestCanvasDriveData<CanvasDrivePreviewPayload>({
    accessToken,
    path: `/workspaces/${encodeURIComponent(workspaceId)}/drive/files/${encodeURIComponent(fileId)}/preview-url`,
    signal,
  });
}
