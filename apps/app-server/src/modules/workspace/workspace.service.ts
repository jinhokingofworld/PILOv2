import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { forbidden, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
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
const DEFAULT_WORKSPACE_NAME_BYTE_LENGTH = 4;

@Injectable()
export class WorkspaceService {
  constructor(private readonly database: DatabaseService) {}

  async ensureDefaultWorkspaceForUser(userId: string): Promise<void> {
    const workspaceName = `PILO-${randomBytes(DEFAULT_WORKSPACE_NAME_BYTE_LENGTH).toString("hex")}`;
    await this.database.execute(
      `
        INSERT INTO workspaces (name, owner_user_id)
        VALUES ($1, $2)
        ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL
        DO NOTHING
      `,
      [workspaceName, userId]
    );
  }

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
