export type DriveItemType = "folder" | "file";

export type DriveUploadStatus = "pending" | "ready" | "failed" | "expired";

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
  uploadStatus: DriveUploadStatus | null;
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
