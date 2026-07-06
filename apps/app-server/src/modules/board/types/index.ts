export type BoardSyncStatus = "running" | "success" | "failed";

export interface BoardRepositoryPayload {
  id: string;
  fullName: string;
  htmlUrl: string;
}

export interface BoardProjectPayload {
  id: string;
  githubProjectNodeId: string;
  projectNumber: number;
  title: string;
  url: string;
}

export interface BoardStatusFieldPayload {
  id: string;
  githubFieldNodeId: string;
  name: string;
}

export interface BoardPayload {
  id: string;
  workspaceId: string;
  name: string;
  repository: BoardRepositoryPayload;
  project: BoardProjectPayload;
  statusField: BoardStatusFieldPayload | null;
  syncStatus: BoardSyncStatus | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBoardResult {
  board: BoardPayload;
  statusCode: 200 | 201;
}
