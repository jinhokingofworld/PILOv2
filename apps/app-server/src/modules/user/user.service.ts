import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, forbidden, unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

interface UserRow extends QueryResultRow {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface UserPresenceRow extends QueryResultRow {
  active_workspace_id: string | null;
  last_seen_at: Date | string;
}

interface WorkspaceMembershipRow extends QueryResultRow {
  id: string;
}

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCurrentUserPresenceRequest {
  activeWorkspaceId?: unknown;
}

export interface UserPresencePayload {
  activeWorkspaceId: string | null;
  lastSeenAt: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}

  async getCurrentUser(currentUserId: string): Promise<UserProfile> {
    const user = await this.database.queryOne<UserRow>(
      `
        SELECT id, name, email, avatar_url, created_at, updated_at
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    if (!user) {
      throw unauthorized("Current user not found");
    }

    return this.mapUser(user);
  }

  async updateCurrentUserPresence(
    currentUserId: string,
    request: UpdateCurrentUserPresenceRequest | undefined
  ): Promise<UserPresencePayload> {
    const activeWorkspaceId = this.readActiveWorkspaceId(request);

    if (activeWorkspaceId) {
      await this.assertWorkspaceMembership(currentUserId, activeWorkspaceId);
    }

    const presence = await this.database.queryOne<UserPresenceRow>(
      `
        UPDATE users
        SET
          active_workspace_id = $2,
          last_seen_at = now()
        WHERE id = $1
        RETURNING active_workspace_id, last_seen_at
      `,
      [currentUserId, activeWorkspaceId]
    );

    if (!presence) {
      throw unauthorized("Current user not found");
    }

    return {
      activeWorkspaceId: presence.active_workspace_id,
      lastSeenAt: this.toIsoString(presence.last_seen_at)
    };
  }

  private mapUser(user: UserRow): UserProfile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      createdAt: this.toIsoString(user.created_at),
      updatedAt: this.toIsoString(user.updated_at)
    };
  }

  private readActiveWorkspaceId(
    request: UpdateCurrentUserPresenceRequest | undefined
  ): string | null {
    if (!request || !("activeWorkspaceId" in request)) {
      throw badRequest("activeWorkspaceId is required");
    }

    if (request.activeWorkspaceId === null) {
      return null;
    }

    if (
      typeof request.activeWorkspaceId !== "string" ||
      !UUID_PATTERN.test(request.activeWorkspaceId)
    ) {
      throw badRequest("activeWorkspaceId must be a workspace UUID or null");
    }

    return request.activeWorkspaceId;
  }

  private async assertWorkspaceMembership(
    currentUserId: string,
    workspaceId: string
  ): Promise<void> {
    const membership = await this.database.queryOne<WorkspaceMembershipRow>(
      `
        SELECT id
        FROM workspace_members
        WHERE workspace_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [workspaceId, currentUserId]
    );

    if (!membership) {
      throw forbidden("Workspace access denied");
    }
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
