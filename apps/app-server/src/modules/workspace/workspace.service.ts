import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, forbidden, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CreateWorkspaceRequest {
  name?: unknown;
}

export interface WorkspacePayload {
  id: string;
  name: string;
  ownerUserId: string | null;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WORKSPACE_NAME_LENGTH = 100;

@Injectable()
export class WorkspaceService {
  constructor(private readonly database: DatabaseService) {}

  async listWorkspaces(currentUserId: string): Promise<WorkspacePayload[]> {
    const workspaces = await this.database.query<WorkspaceRow>(
      `
        SELECT id, name, owner_user_id, created_at, updated_at
        FROM workspaces
        WHERE owner_user_id = $1
        ORDER BY created_at ASC
      `,
      [currentUserId]
    );

    return workspaces.map((workspace) => this.mapWorkspace(workspace, currentUserId));
  }

  async createWorkspace(
    currentUserId: string,
    input: CreateWorkspaceRequest
  ): Promise<WorkspacePayload> {
    const name = this.validateWorkspaceName(input.name);
    const workspace = await this.database.queryOne<WorkspaceRow>(
      `
        INSERT INTO workspaces (name, owner_user_id)
        VALUES ($1, $2)
        RETURNING id, name, owner_user_id, created_at, updated_at
      `,
      [name, currentUserId]
    );

    if (!workspace) {
      throw badRequest("Workspace could not be created");
    }

    return this.mapWorkspace(workspace, currentUserId);
  }

  async getWorkspace(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspacePayload> {
    const workspace = await this.findWorkspaceById(workspaceId);

    if (!workspace) {
      throw notFound("Workspace not found");
    }

    if (workspace.owner_user_id !== currentUserId) {
      throw forbidden("Workspace access denied");
    }

    return this.mapWorkspace(workspace, currentUserId);
  }

  async assertWorkspaceAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspacePayload> {
    return this.getWorkspace(currentUserId, workspaceId);
  }

  private async findWorkspaceById(workspaceId: string): Promise<WorkspaceRow | null> {
    if (!UUID_PATTERN.test(workspaceId)) {
      return null;
    }

    return this.database.queryOne<WorkspaceRow>(
      `
        SELECT id, name, owner_user_id, created_at, updated_at
        FROM workspaces
        WHERE id = $1
      `,
      [workspaceId]
    );
  }

  private validateWorkspaceName(value: unknown): string {
    if (typeof value !== "string") {
      throw badRequest("Workspace name is required");
    }

    const name = value.trim();
    if (!name) {
      throw badRequest("Workspace name is required");
    }

    if (name.length > MAX_WORKSPACE_NAME_LENGTH) {
      throw badRequest("Workspace name must be 100 characters or less");
    }

    return name;
  }

  private mapWorkspace(
    workspace: WorkspaceRow,
    currentUserId: string
  ): WorkspacePayload {
    return {
      id: workspace.id,
      name: workspace.name,
      ownerUserId: workspace.owner_user_id,
      isOwner: workspace.owner_user_id === currentUserId,
      createdAt: this.toIsoString(workspace.created_at),
      updatedAt: this.toIsoString(workspace.updated_at)
    };
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
