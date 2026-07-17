import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  badRequest,
  conflict,
  forbidden,
  unauthorized
} from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceMembershipRevocationOutboxService } from "../workspace-membership-revocation/workspace-membership-revocation-outbox.service";

export type AvatarMode = "provider" | "custom" | "initials";

interface UserRow extends QueryResultRow {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  google_user_id: string | null;
  github_user_id: string | null;
  display_name: string | null;
  job_title: string | null;
  bio: string | null;
  avatar_mode: AvatarMode;
  custom_avatar_url: string | null;
  avatar_color: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DeletedWorkspaceMembershipRow extends QueryResultRow {
  workspace_id: string;
}

interface ProfileSettingsRow extends QueryResultRow {
  display_name: string | null;
  job_title: string | null;
  bio: string | null;
  avatar_mode: AvatarMode;
  custom_avatar_url: string | null;
  avatar_color: string;
}

interface UserPresenceRow extends QueryResultRow {
  active_workspace_id: string | null;
  last_seen_at: Date | string;
}

interface WorkspaceMembershipRow extends QueryResultRow {
  id: string;
}

interface CountRow extends QueryResultRow {
  count: string;
}

export interface UserProfile {
  id: string;
  name: string | null;
  displayName: string;
  jobTitle: string | null;
  bio: string | null;
  email: string | null;
  avatarUrl: string | null;
  providerAvatarUrl: string | null;
  customAvatarUrl: string | null;
  avatarMode: AvatarMode;
  avatarColor: string;
  loginProviders: Array<"google" | "github">;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateCurrentUserProfileRequest {
  displayName?: unknown;
  jobTitle?: unknown;
  bio?: unknown;
  avatarMode?: unknown;
  customAvatarUrl?: unknown;
  avatarColor?: unknown;
}

export interface DeleteCurrentUserRequest {
  confirmationText?: unknown;
}

export interface DeleteCurrentUserPayload {
  deleted: true;
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
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PROFILE_FIELDS = new Set([
  "displayName",
  "jobTitle",
  "bio",
  "avatarMode",
  "customAvatarUrl",
  "avatarColor"
]);

@Injectable()
export class UserService {
  constructor(
    private readonly database: DatabaseService,
    private readonly membershipRevocationOutbox: WorkspaceMembershipRevocationOutboxService
  ) {}

  async getCurrentUser(currentUserId: string): Promise<UserProfile> {
    const user = await this.database.queryOne<UserRow>(
      `
        SELECT
          u.id,
          u.name,
          u.email,
          u.avatar_url,
          u.google_user_id,
          u.github_user_id,
          us.display_name,
          us.job_title,
          us.bio,
          COALESCE(us.avatar_mode, 'provider') AS avatar_mode,
          us.custom_avatar_url,
          COALESCE(us.avatar_color, '#6366F1') AS avatar_color,
          u.created_at,
          GREATEST(u.updated_at, COALESCE(us.updated_at, u.updated_at)) AS updated_at
        FROM users u
        LEFT JOIN user_settings us ON us.user_id = u.id
        WHERE u.id = $1 AND u.deleted_at IS NULL
      `,
      [currentUserId]
    );

    if (!user) {
      throw unauthorized("Current user not found");
    }

    return this.mapUser(user);
  }

  async updateCurrentUserProfile(
    currentUserId: string,
    request: UpdateCurrentUserProfileRequest | undefined
  ): Promise<UserProfile> {
    const input = this.readProfileRequest(request);
    const current = await this.getProfileSettings(currentUserId);
    const next = {
      displayName:
        "displayName" in input
          ? this.readNullableText(input.displayName, "displayName", 100)
          : current.display_name,
      jobTitle:
        "jobTitle" in input
          ? this.readNullableText(input.jobTitle, "jobTitle", 100)
          : current.job_title,
      bio:
        "bio" in input
          ? this.readNullableText(input.bio, "bio", 500)
          : current.bio,
      avatarMode:
        "avatarMode" in input
          ? this.readAvatarMode(input.avatarMode)
          : current.avatar_mode,
      customAvatarUrl:
        "customAvatarUrl" in input
          ? this.readCustomAvatarUrl(input.customAvatarUrl)
          : current.custom_avatar_url,
      avatarColor:
        "avatarColor" in input
          ? this.readAvatarColor(input.avatarColor)
          : current.avatar_color
    };

    if (next.avatarMode === "custom" && !next.customAvatarUrl) {
      throw badRequest("customAvatarUrl is required for custom avatar mode");
    }

    await this.database.execute(
      `
        INSERT INTO user_settings (
          user_id,
          display_name,
          job_title,
          bio,
          avatar_mode,
          custom_avatar_url,
          avatar_color
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE
        SET
          display_name = EXCLUDED.display_name,
          job_title = EXCLUDED.job_title,
          bio = EXCLUDED.bio,
          avatar_mode = EXCLUDED.avatar_mode,
          custom_avatar_url = EXCLUDED.custom_avatar_url,
          avatar_color = EXCLUDED.avatar_color
      `,
      [
        currentUserId,
        next.displayName,
        next.jobTitle,
        next.bio,
        next.avatarMode,
        next.customAvatarUrl,
        next.avatarColor
      ]
    );

    return this.getCurrentUser(currentUserId);
  }

  async deleteCurrentUser(
    currentUserId: string,
    request: DeleteCurrentUserRequest | undefined
  ): Promise<DeleteCurrentUserPayload> {
    if (!request || request.confirmationText !== "계정 탈퇴") {
      throw badRequest("confirmationText must be 계정 탈퇴");
    }

    const owned = await this.database.queryOne<CountRow>(
      `
        SELECT COUNT(*)::text AS count
        FROM workspace_members
        WHERE user_id = $1 AND role = 'owner'
      `,
      [currentUserId]
    );
    if (Number(owned?.count ?? "0") > 0) {
      throw conflict("소유 중인 Workspace를 먼저 삭제하거나 소유권을 이전해주세요.");
    }

    const outboxIds = await this.database.transaction(
      async transaction => {
        await transaction.execute(
          `
            UPDATE user_sessions
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE user_id = $1
          `,
          [currentUserId]
        );
        await transaction.execute(
          `
            UPDATE github_oauth_connections
            SET access_token_encrypted = NULL, revoked_at = COALESCE(revoked_at, now())
            WHERE user_id = $1
          `,
          [currentUserId]
        );
        const deletedMemberships =
          await transaction.query<DeletedWorkspaceMembershipRow>(
            `
              DELETE FROM workspace_members
              WHERE user_id = $1
              RETURNING workspace_id
            `,
            [currentUserId]
          );
        await transaction.execute(
          `DELETE FROM user_settings WHERE user_id = $1`,
          [currentUserId]
        );
        await transaction.execute(
          `
            UPDATE users
            SET
              name = '탈퇴한 사용자',
              email = NULL,
              avatar_url = NULL,
              github_user_id = NULL,
              github_login = NULL,
              google_user_id = NULL,
              google_connected_at = NULL,
              google_revoked_at = now(),
              active_workspace_id = NULL,
              deleted_at = now()
            WHERE id = $1 AND deleted_at IS NULL
          `,
          [currentUserId]
        );

        return Promise.all(
          [...new Set(deletedMemberships.map(membership => membership.workspace_id))].map(
            workspaceId =>
              this.membershipRevocationOutbox.enqueueMembershipRevoked(
                transaction,
                workspaceId,
                currentUserId
              )
          )
        );
      }
    );

    await Promise.all(
      outboxIds.map(outboxId => this.membershipRevocationOutbox.publishOutbox(outboxId))
    );

    return { deleted: true };
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
        SET active_workspace_id = $2, last_seen_at = now()
        WHERE id = $1 AND deleted_at IS NULL
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

  private async getProfileSettings(
    currentUserId: string
  ): Promise<ProfileSettingsRow> {
    const row = await this.database.queryOne<ProfileSettingsRow>(
      `
        SELECT
          display_name,
          job_title,
          bio,
          avatar_mode,
          custom_avatar_url,
          avatar_color
        FROM user_settings
        WHERE user_id = $1
      `,
      [currentUserId]
    );
    return (
      row ?? {
        display_name: null,
        job_title: null,
        bio: null,
        avatar_mode: "provider",
        custom_avatar_url: null,
        avatar_color: "#6366F1"
      }
    );
  }

  private readProfileRequest(
    request: UpdateCurrentUserProfileRequest | undefined
  ): Record<string, unknown> {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw badRequest("Profile request body is required");
    }
    const input = request as Record<string, unknown>;
    const keys = Object.keys(input);
    if (keys.length === 0) {
      throw badRequest("At least one profile field is required");
    }
    if (keys.some((key) => !PROFILE_FIELDS.has(key))) {
      throw badRequest("Unsupported profile field");
    }
    return input;
  }

  private readNullableText(
    value: unknown,
    field: string,
    maxLength: number
  ): string | null {
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string or null`);
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
      throw badRequest(`${field} must be between 1 and ${maxLength} characters`);
    }
    return normalized;
  }

  private readAvatarMode(value: unknown): AvatarMode {
    if (value === "provider" || value === "custom" || value === "initials") {
      return value;
    }
    throw badRequest("avatarMode is invalid");
  }

  private readCustomAvatarUrl(value: unknown): string | null {
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw badRequest("customAvatarUrl must be an HTTPS URL or null");
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > 2048) {
      throw badRequest("customAvatarUrl is invalid");
    }
    try {
      const url = new URL(normalized);
      if (url.protocol !== "https:") {
        throw new Error("HTTPS required");
      }
    } catch {
      throw badRequest("customAvatarUrl must be a valid HTTPS URL");
    }
    return normalized;
  }

  private readAvatarColor(value: unknown): string {
    if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
      throw badRequest("avatarColor must be #RRGGBB");
    }
    return value.toUpperCase();
  }

  private mapUser(user: UserRow): UserProfile {
    const displayName =
      user.display_name?.trim() ||
      user.name?.trim() ||
      user.email?.split("@", 1)[0] ||
      "PILO 사용자";
    const avatarUrl =
      user.avatar_mode === "custom"
        ? user.custom_avatar_url
        : user.avatar_mode === "initials"
          ? null
          : user.avatar_url;
    const loginProviders: Array<"google" | "github"> = [];
    if (user.google_user_id) loginProviders.push("google");
    if (user.github_user_id) loginProviders.push("github");

    return {
      id: user.id,
      name: user.name,
      displayName,
      jobTitle: user.job_title,
      bio: user.bio,
      email: user.email,
      avatarUrl,
      providerAvatarUrl: user.avatar_url,
      customAvatarUrl: user.custom_avatar_url,
      avatarMode: user.avatar_mode,
      avatarColor: user.avatar_color,
      loginProviders,
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
        WHERE workspace_id = $1 AND user_id = $2
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
