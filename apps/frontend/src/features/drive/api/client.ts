import type {
  CreateDriveFolderInput,
  CreateDriveUploadUrlInput,
  CreateDriveUploadUrlPayload,
  CompleteDriveUploadInput,
  CreateDocumentInput,
  CreateDocumentPayload,
  DeleteDriveItemPayload,
  DocumentBootstrapPayload,
  DriveDownloadUrlPayload,
  DriveItem,
  DriveListPayload,
  ListDriveItemsQuery,
  SaveDocumentSnapshotInput,
  SaveDocumentSnapshotPayload,
  UpdateDriveItemInput
} from "@/features/drive/types";

const API_BASE_PATH = "/api/v1";
const DEFAULT_APP_SERVER_ORIGIN = "http://localhost:4000";

type DriveClientOptions = {
  accessToken?: string | null;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

type DriveApiSuccessResponse<T> = {
  success: true;
  data: T;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultDriveApiBaseUrl() {
  const appServerOrigin = trimTrailingSlash(
    process.env.NEXT_PUBLIC_PILO_APP_SERVER_URL ?? DEFAULT_APP_SERVER_ORIGIN
  );

  return appServerOrigin.endsWith(API_BASE_PATH)
    ? appServerOrigin
    : `${appServerOrigin}${API_BASE_PATH}`;
}

export function getDriveApiBaseUrl(baseUrl = defaultDriveApiBaseUrl()) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return normalizedBaseUrl.endsWith(API_BASE_PATH)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}${API_BASE_PATH}`;
}

export function buildDriveApiUrl(
  path: `/${string}`,
  baseUrl = defaultDriveApiBaseUrl()
) {
  return `${getDriveApiBaseUrl(baseUrl)}${path}`;
}

export class DriveApiError extends Error {
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
    this.name = "DriveApiError";
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

async function readDriveJson(response: Response, path: string) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new DriveApiError("Drive API returned invalid JSON", {
      status: response.status,
      path
    });
  }
}

function unwrapDriveData<T>(
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
    return (payload as DriveApiSuccessResponse<T>).data;
  }

  if (
    isRecord(payload) &&
    payload.success === false &&
    isRecord(payload.error)
  ) {
    throw new DriveApiError(
      typeof payload.error.message === "string"
        ? payload.error.message
        : "Drive API request failed",
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

  throw new DriveApiError("Drive API returned an unexpected response", {
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

function withQueryParams(path: `/${string}`, query: ListDriveItemsQuery = {}) {
  const params = new URLSearchParams();

  if (query.parentId) {
    params.set("parentId", query.parentId);
  }

  const search = params.toString();
  return search ? (`${path}?${search}` as `/${string}`) : path;
}

async function requestDriveData<T>(
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

  const response = await fetcher(buildDriveApiUrl(path, baseUrl), {
    credentials: "same-origin",
    ...init,
    headers
  });
  const payload = await readDriveJson(response, path);

  if (!response.ok) {
    const apiError = readApiErrorMessage(payload);
    throw new DriveApiError(apiError?.message ?? "Drive API request failed", {
      code: apiError?.code,
      path,
      status: response.status
    });
  }

  return unwrapDriveData<T>(payload, {
    path,
    status: response.status
  });
}

function driveItemsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/drive/items` as const;
}

function driveFoldersPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/drive/folders` as const;
}

function driveDocumentsPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/drive/documents` as const;
}

function driveDocumentPath(workspaceId: string, documentId: string) {
  return `${driveDocumentsPath(workspaceId)}/${encodeURIComponent(documentId)}` as const;
}

function driveUploadUrlPath(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(
    workspaceId
  )}/drive/files/upload-url` as const;
}

function driveFilePath(workspaceId: string, fileId: string) {
  return `/workspaces/${encodeURIComponent(
    workspaceId
  )}/drive/files/${encodeURIComponent(fileId)}` as const;
}

function driveItemPath(workspaceId: string, itemId: string) {
  return `/workspaces/${encodeURIComponent(
    workspaceId
  )}/drive/items/${encodeURIComponent(itemId)}` as const;
}

export type UploadDriveFileProgress = {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
};

export function uploadDriveFileToPresignedUrl({
  file,
  headers,
  onProgress,
  uploadUrl
}: {
  file: File;
  headers: Record<string, string>;
  onProgress?: (progress: UploadDriveFileProgress) => void;
  uploadUrl: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.open("PUT", uploadUrl);

    for (const [key, value] of Object.entries(headers)) {
      request.setRequestHeader(key, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }

      onProgress?.({
        loadedBytes: event.loaded,
        totalBytes: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100))
      });
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }

      reject(
        new DriveApiError("파일 업로드에 실패했습니다.", {
          status: request.status
        })
      );
    };

    request.onerror = () => {
      reject(new DriveApiError("파일 업로드 요청을 완료하지 못했습니다."));
    };

    request.onabort = () => {
      reject(new DriveApiError("파일 업로드가 취소되었습니다."));
    };

    request.send(file);
  });
}

export function createDriveApiClient({
  accessToken = null,
  baseUrl = defaultDriveApiBaseUrl(),
  fetcher = fetch
}: DriveClientOptions = {}) {
  const requestOptions = {
    accessToken: accessToken?.trim() || null,
    baseUrl,
    fetcher
  };

  return {
    async listItems(workspaceId: string, query: ListDriveItemsQuery = {}) {
      return requestDriveData<DriveListPayload>(
        withQueryParams(driveItemsPath(workspaceId), query),
        undefined,
        requestOptions
      );
    },

    async createFolder(workspaceId: string, body: CreateDriveFolderInput) {
      return requestDriveData<DriveItem>(
        driveFoldersPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async createDocument(workspaceId: string, body: CreateDocumentInput = {}) {
      return requestDriveData<CreateDocumentPayload>(
        driveDocumentsPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async getDocument(workspaceId: string, documentId: string) {
      return requestDriveData<DocumentBootstrapPayload>(
        driveDocumentPath(workspaceId, documentId),
        undefined,
        requestOptions
      );
    },

    async saveDocumentSnapshot(
      workspaceId: string,
      documentId: string,
      body: SaveDocumentSnapshotInput
    ) {
      return requestDriveData<SaveDocumentSnapshotPayload>(
        `${driveDocumentPath(workspaceId, documentId)}/snapshot`,
        withJsonBody(body, { method: "PUT" }),
        requestOptions
      );
    },

    async createUploadUrl(
      workspaceId: string,
      body: CreateDriveUploadUrlInput
    ) {
      return requestDriveData<CreateDriveUploadUrlPayload>(
        driveUploadUrlPath(workspaceId),
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async completeUpload(
      workspaceId: string,
      fileId: string,
      body: CompleteDriveUploadInput
    ) {
      return requestDriveData<DriveItem>(
        `${driveFilePath(workspaceId, fileId)}/complete`,
        withJsonBody(body, { method: "POST" }),
        requestOptions
      );
    },

    async createDownloadUrl(workspaceId: string, fileId: string) {
      return requestDriveData<DriveDownloadUrlPayload>(
        `${driveFilePath(workspaceId, fileId)}/download-url`,
        undefined,
        requestOptions
      );
    },

    async updateItem(
      workspaceId: string,
      itemId: string,
      body: UpdateDriveItemInput
    ) {
      return requestDriveData<DriveItem>(
        driveItemPath(workspaceId, itemId),
        withJsonBody(body, { method: "PATCH" }),
        requestOptions
      );
    },

    async deleteItem(workspaceId: string, itemId: string) {
      return requestDriveData<DeleteDriveItemPayload>(
        driveItemPath(workspaceId, itemId),
        { method: "DELETE" },
        requestOptions
      );
    }
  };
}
