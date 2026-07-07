export type DriveItemType = "folder" | "file";

export type DriveItemUploadStatus = "pending" | "ready" | "failed" | "expired";

export type DriveUploadStatus = "pending" | "completed" | "failed" | "expired";

export type DriveUserSummary = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type DriveItem = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  itemType: DriveItemType;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadStatus: DriveItemUploadStatus | null;
  createdByUser: DriveUserSummary;
  updatedByUser: DriveUserSummary | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DriveListPayload = {
  parent: DriveItem | null;
  breadcrumbs: DriveItem[];
  items: DriveItem[];
};

export type ListDriveItemsQuery = {
  parentId?: string | null;
};

export type CreateDriveFolderInput = {
  parentId?: string | null;
  name: string;
};

export type DriveUpload = {
  id: string;
  fileId: string;
  status: DriveUploadStatus;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
};

export type CreateDriveUploadUrlInput = {
  parentId?: string | null;
  name: string;
  sizeBytes: number;
  mimeType: string;
};

export type CreateDriveUploadUrlPayload = {
  file: DriveItem;
  upload: DriveUpload;
};

export type CompleteDriveUploadInput = {
  uploadId: string;
};

export type DriveDownloadUrlPayload = {
  file: DriveItem;
  downloadUrl: string;
  expiresAt: string;
};

export type UpdateDriveItemInput = {
  name: string;
};

export type DeleteDriveItemPayload = {
  id: string;
  deleted: true;
  deletedItemCount: number;
};
