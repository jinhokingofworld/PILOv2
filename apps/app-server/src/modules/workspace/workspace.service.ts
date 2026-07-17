import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, conflict, forbidden, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceMembershipRevocationPublisherService } from "../workspace-membership-revocation/workspace-membership-revocation-publisher.service";

export type WorkspaceRole = "owner" | "member";
type WorkspaceInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
  icon: string | null;
  owner_user_id: string | null;
  role: WorkspaceRole | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceIdRow extends QueryResultRow {
  id: string;
}

interface WorkspaceMemberRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  invited_by_user_id: string | null;
  joined_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  user_name: string | null;
  user_email: string | null;
  user_job_title: string | null;
  user_bio: string | null;
  user_avatar_url: string | null;
  user_active_workspace_id: string | null;
  user_last_seen_at: Date | string | null;
}

interface WorkspaceInvitationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token_hash: string;
  status: WorkspaceInvitationStatus;
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  revoked_by_user_id: string | null;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceInvitationDetailRow extends WorkspaceInvitationRow {
  workspace_name: string;
}

interface UserEmailRow extends QueryResultRow {
  id: string;
  email: string | null;
}

interface CountRow extends QueryResultRow {
  count: string;
}

interface WorkspaceDeletionBlockerRow extends QueryResultRow {
  other_member_exists: boolean;
  github_installation_exists: boolean;
  active_meeting_exists: boolean;
  active_sync_exists: boolean;
}

export interface WorkspacePayload {
  id: string;
  name: string;
  icon: string | null;
  ownerUserId: string | null;
  role: WorkspaceRole;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberPayload {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedByUserId: string | null;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    jobTitle: string | null;
    bio: string | null;
    avatarUrl: string | null;
    activeWorkspaceId: string | null;
    lastSeenAt: string | null;
  };
}

export interface WorkspaceInvitationPayload {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  invitedByUserId: string;
  acceptedByUserId: string | null;
  revokedByUserId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInvitationRequest {
  email?: unknown;
  role?: unknown;
}

export interface CreateWorkspaceRequest {
  icon?: unknown;
  name?: unknown;
}

export interface UpdateWorkspaceRequest {
  icon?: unknown;
  name?: unknown;
}

export interface DeleteWorkspaceRequest {
  confirmationName?: unknown;
}

export interface DeleteWorkspacePayload {
  deleted: true;
  workspaceId: string;
}

export interface CreateWorkspaceInvitationPayload {
  invitation: WorkspaceInvitationPayload;
  invitationToken: string;
  acceptUrl: string;
}

export interface WorkspaceInvitationTokenPayload {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  expiresAt: string;
}

export interface CurrentUserWorkspaceInvitationPayload {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitationStatus;
  invitedByUserId: string;
  expiresAt: string;
  createdAt: string;
}

export interface AcceptWorkspaceInvitationPayload {
  workspace: WorkspacePayload;
  membership: WorkspaceMemberPayload;
}

export interface RemoveWorkspaceMemberPayload {
  removed: true;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_TOKEN_BYTE_LENGTH = 32;
const DEFAULT_INVITATION_TTL_DAYS = 7;
const FRONTEND_DEFAULT_ORIGIN = "http://localhost:3000";

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly membershipRevocationPublisher: WorkspaceMembershipRevocationPublisherService
  ) {}

  async createWorkspace(
    currentUserId: string,
    request: CreateWorkspaceRequest
  ): Promise<WorkspacePayload> {
    const name = this.readWorkspaceName(request.name);
    const icon = this.readWorkspaceIcon(request.icon);

    return this.database.transaction(async (transaction) => {
      const workspace = await transaction.queryOne<WorkspaceRow>(
        `
          INSERT INTO workspaces (name, icon, owner_user_id)
          VALUES ($1, $2, $3)
          RETURNING
            id,
            name,
            icon,
            owner_user_id,
            'owner'::text AS role,
            created_at,
            updated_at
        `,
        [name, icon, currentUserId]
      );

      if (!workspace) {
        throw new Error("Workspace could not be created");
      }

      await transaction.execute(
        `
          INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
          VALUES ($1, $2, 'owner', now())
        `,
        [workspace.id, currentUserId]
      );

      return this.mapWorkspace(workspace, currentUserId);
    });
  }

  async listWorkspaces(currentUserId: string): Promise<WorkspacePayload[]> {
    const workspaces = await this.database.query<WorkspaceRow>(
      `
        SELECT
          w.id,
          w.name,
          w.icon,
          w.owner_user_id,
          wm.role,
          w.created_at,
          w.updated_at
        FROM workspace_members wm
        JOIN workspaces w
          ON w.id = wm.workspace_id
        WHERE wm.user_id = $1
        ORDER BY wm.joined_at ASC, w.created_at ASC
      `,
      [currentUserId]
    );

    return workspaces.map((workspace) =>
      this.mapWorkspace(workspace, currentUserId)
    );
  }

  async updateWorkspace(
    currentUserId: string,
    workspaceId: string,
    request: UpdateWorkspaceRequest | undefined
  ): Promise<WorkspacePayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw badRequest("Workspace request body is required");
    }
    const keys = Object.keys(request);
    if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "icon")) {
      throw badRequest("Workspace name or icon is required");
    }

    const hasName = Object.prototype.hasOwnProperty.call(request, "name");
    const hasIcon = Object.prototype.hasOwnProperty.call(request, "icon");
    const name = hasName ? this.readWorkspaceName(request.name) : null;
    const icon = hasIcon ? this.readWorkspaceIcon(request.icon) : null;

    await this.database.execute(
      `
        UPDATE workspaces
        SET
          name = CASE WHEN $2::boolean THEN $3 ELSE name END,
          icon = CASE WHEN $4::boolean THEN $5 ELSE icon END
        WHERE id = $1
      `,
      [workspaceId, hasName, name, hasIcon, icon]
    );

    return this.getWorkspace(currentUserId, workspaceId);
  }

  async deleteWorkspace(
    currentUserId: string,
    workspaceId: string,
    request: DeleteWorkspaceRequest | undefined
  ): Promise<DeleteWorkspacePayload> {
    const workspace = await this.assertWorkspaceOwnerAccess(
      currentUserId,
      workspaceId
    );
    if (!request || request.confirmationName !== workspace.name) {
      throw badRequest("confirmationName must match the current Workspace name");
    }

    const blockers = await this.database.queryOne<WorkspaceDeletionBlockerRow>(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM workspace_members
            WHERE workspace_id = $1 AND user_id <> $2
          ) AS other_member_exists,
          EXISTS (
            SELECT 1 FROM github_installations WHERE workspace_id = $1
          ) AS github_installation_exists,
          EXISTS (
            SELECT 1 FROM meetings WHERE workspace_id = $1 AND ended_at IS NULL
          ) AS active_meeting_exists,
          EXISTS (
            SELECT 1
            FROM github_sync_runs
            WHERE workspace_id = $1 AND status IN ('queued', 'running')
          ) AS active_sync_exists
      `,
      [workspaceId, currentUserId]
    );

    const messages: string[] = [];
    if (blockers?.other_member_exists) {
      messages.push(
        "Workspace에 다른 멤버가 남아 있습니다. 멤버를 모두 제거한 뒤 삭제해주세요."
      );
    }
    if (blockers?.github_installation_exists) {
      messages.push("GitHub App 연결을 먼저 해제해주세요.");
    }
    if (blockers?.active_meeting_exists) {
      messages.push("진행 중인 회의를 먼저 종료해주세요.");
    }
    if (blockers?.active_sync_exists) {
      messages.push("진행 중인 동기화 작업이 끝난 뒤 다시 시도해주세요.");
    }
    if (messages.length > 0) {
      throw conflict(messages.join(" "));
    }

    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        "SELECT set_config('pilo.activity_log_tenant_purge', 'on', true)"
      );
      await transaction.execute(`DELETE FROM workspaces WHERE id = $1`, [
        workspaceId
      ]);
    });
    return { deleted: true, workspaceId };
  }

  async getWorkspace(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspacePayload> {
    const workspace = await this.findWorkspaceForUser(currentUserId, workspaceId);

    if (!workspace) {
      throw notFound("Workspace not found");
    }

    if (!workspace.role) {
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

  async assertWorkspaceOwnerAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspacePayload> {
    const workspace = await this.getWorkspace(currentUserId, workspaceId);

    if (workspace.role !== "owner") {
      throw forbidden("Workspace owner access required");
    }

    return workspace;
  }

  async listMembers(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspaceMemberPayload[]> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);

    const members = await this.database.query<WorkspaceMemberRow>(
      `
        SELECT
          wm.id,
          wm.workspace_id,
          wm.user_id,
          wm.role,
          wm.invited_by_user_id,
          wm.joined_at,
          wm.created_at,
          wm.updated_at,
          COALESCE(
            NULLIF(BTRIM(us.display_name), ''),
            NULLIF(BTRIM(u.name), ''),
            NULLIF(split_part(u.email, '@', 1), ''),
            'PILO 사용자'
          ) AS user_name,
          u.email AS user_email,
          us.job_title AS user_job_title,
          us.bio AS user_bio,
          CASE COALESCE(us.avatar_mode, 'provider')
            WHEN 'custom' THEN us.custom_avatar_url
            WHEN 'initials' THEN NULL
            ELSE u.avatar_url
          END AS user_avatar_url,
          u.active_workspace_id AS user_active_workspace_id,
          u.last_seen_at AS user_last_seen_at
        FROM workspace_members wm
        JOIN users u
          ON u.id = wm.user_id
        LEFT JOIN user_settings us
          ON us.user_id = u.id
        WHERE wm.workspace_id = $1
        ORDER BY
          CASE wm.role WHEN 'owner' THEN 0 ELSE 1 END,
          wm.joined_at ASC
      `,
      [workspaceId]
    );

    return members.map((member) => this.mapMember(member));
  }

  async removeMember(
    currentUserId: string,
    workspaceId: string,
    targetUserId: string
  ): Promise<RemoveWorkspaceMemberPayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    this.validateUserId(targetUserId);

    await this.database.transaction(async (transaction) => {
      const membership = await transaction.queryOne<WorkspaceMemberRow>(
        `
          SELECT
            wm.id,
            wm.workspace_id,
            wm.user_id,
            wm.role,
            wm.invited_by_user_id,
            wm.joined_at,
            wm.created_at,
            wm.updated_at,
            COALESCE(
              NULLIF(BTRIM(us.display_name), ''),
              NULLIF(BTRIM(u.name), ''),
              NULLIF(split_part(u.email, '@', 1), ''),
              'PILO 사용자'
            ) AS user_name,
            u.email AS user_email,
            us.job_title AS user_job_title,
            us.bio AS user_bio,
            CASE COALESCE(us.avatar_mode, 'provider')
              WHEN 'custom' THEN us.custom_avatar_url
              WHEN 'initials' THEN NULL
              ELSE u.avatar_url
            END AS user_avatar_url,
            u.active_workspace_id AS user_active_workspace_id,
            u.last_seen_at AS user_last_seen_at
          FROM workspace_members wm
          JOIN users u
            ON u.id = wm.user_id
          LEFT JOIN user_settings us
            ON us.user_id = u.id
          WHERE wm.workspace_id = $1
            AND wm.user_id = $2
          FOR UPDATE OF wm
        `,
        [workspaceId, targetUserId]
      );

      if (!membership) {
        throw notFound("Workspace member not found");
      }

      if (membership.role === "owner") {
        const ownerCount = await transaction.queryOne<CountRow>(
          `
            SELECT COUNT(*)::text AS count
            FROM workspace_members
            WHERE workspace_id = $1
              AND role = 'owner'
          `,
          [workspaceId]
        );

        if (Number(ownerCount?.count ?? "0") <= 1) {
          throw badRequest("Workspace must keep at least one owner");
        }
      }

      await transaction.execute(
        `
          DELETE FROM workspace_members
          WHERE workspace_id = $1
            AND user_id = $2
        `,
        [workspaceId, targetUserId]
      );
    });

    await this.publishMembershipRevocation(workspaceId, targetUserId);

    return {
      removed: true
    };
  }

  async leaveWorkspace(
    currentUserId: string,
    workspaceId: string
  ): Promise<RemoveWorkspaceMemberPayload> {
    const workspace = await this.assertWorkspaceAccess(currentUserId, workspaceId);

    if (workspace.role === "owner") {
      throw badRequest("Workspace owner cannot leave own workspace");
    }

    await this.database.transaction(async transaction => {
      await transaction.execute(
        `
          DELETE FROM workspace_members
          WHERE workspace_id = $1
            AND user_id = $2
        `,
        [workspaceId, currentUserId]
      );
    });

    await this.publishMembershipRevocation(workspaceId, currentUserId);

    return {
      removed: true
    };
  }

  async listInvitations(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspaceInvitationPayload[]> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    await this.expirePendingInvitationsForWorkspace(workspaceId);

    const invitations = await this.database.query<WorkspaceInvitationRow>(
      `
        SELECT
          id,
          workspace_id,
          email,
          role,
          token_hash,
          status,
          invited_by_user_id,
          accepted_by_user_id,
          revoked_by_user_id,
          expires_at,
          accepted_at,
          revoked_at,
          created_at,
          updated_at
        FROM workspace_invitations
        WHERE workspace_id = $1
        ORDER BY created_at DESC
      `,
      [workspaceId]
    );

    return invitations.map((invitation) => this.mapInvitation(invitation));
  }

  async createInvitation(
    currentUserId: string,
    workspaceId: string,
    request: CreateWorkspaceInvitationRequest
  ): Promise<CreateWorkspaceInvitationPayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);

    const email = this.readInvitationEmail(request.email);
    const role = this.readInvitationRole(request.role);
    const invitationToken = this.createInvitationToken();
    const tokenHash = this.hashInvitationToken(invitationToken);

    await this.expirePendingInvitationsForEmail(workspaceId, email);

    const existingUser = await this.database.queryOne<UserEmailRow>(
      `
        SELECT id, email
        FROM users
        WHERE lower(email) = $1
      `,
      [email]
    );

    if (existingUser) {
      const existingMember = await this.database.queryOne<WorkspaceIdRow>(
        `
          SELECT id
          FROM workspace_members
          WHERE workspace_id = $1
            AND user_id = $2
        `,
        [workspaceId, existingUser.id]
      );

      if (existingMember) {
        throw badRequest("User is already a workspace member");
      }
    }

    try {
      const invitation = await this.database.queryOne<WorkspaceInvitationRow>(
        `
          INSERT INTO workspace_invitations (
            workspace_id,
            email,
            role,
            token_hash,
            status,
            invited_by_user_id,
            expires_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'pending',
            $5,
            now() + ($6::int * interval '1 day')
          )
          RETURNING
            id,
            workspace_id,
            email,
            role,
            token_hash,
            status,
            invited_by_user_id,
            accepted_by_user_id,
            revoked_by_user_id,
            expires_at,
            accepted_at,
            revoked_at,
            created_at,
            updated_at
        `,
        [
          workspaceId,
          email,
          role,
          tokenHash,
          currentUserId,
          DEFAULT_INVITATION_TTL_DAYS
        ]
      );

      if (!invitation) {
        throw new Error("Workspace invitation could not be created");
      }

      return {
        invitation: this.mapInvitation(invitation),
        invitationToken,
        acceptUrl: this.buildInvitationAcceptUrl(invitationToken)
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw badRequest("Pending workspace invitation already exists");
      }

      throw error;
    }
  }

  async getInvitationByToken(
    invitationToken: string
  ): Promise<WorkspaceInvitationTokenPayload> {
    const invitation = await this.findInvitationByToken(invitationToken);

    if (!invitation) {
      throw notFound("Workspace invitation not found");
    }

    const resolvedInvitation = await this.resolveInvitationExpiration(invitation);

    return {
      workspaceId: resolvedInvitation.workspace_id,
      workspaceName: resolvedInvitation.workspace_name,
      email: resolvedInvitation.email,
      role: resolvedInvitation.role,
      status: resolvedInvitation.status,
      expiresAt: this.toIsoString(resolvedInvitation.expires_at)
    };
  }

  async listCurrentUserInvitations(
    currentUserId: string
  ): Promise<CurrentUserWorkspaceInvitationPayload[]> {
    const user = await this.database.queryOne<UserEmailRow>(
      `
        SELECT id, email
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    const userEmail = user?.email?.trim().toLowerCase();
    if (!userEmail) {
      return [];
    }

    await this.expirePendingInvitationsForUserEmail(userEmail);

    const invitations = await this.database.query<WorkspaceInvitationDetailRow>(
      `
        SELECT
          wi.id,
          wi.workspace_id,
          wi.email,
          wi.role,
          wi.token_hash,
          wi.status,
          wi.invited_by_user_id,
          wi.accepted_by_user_id,
          wi.revoked_by_user_id,
          wi.expires_at,
          wi.accepted_at,
          wi.revoked_at,
          wi.created_at,
          wi.updated_at,
          w.name AS workspace_name
        FROM workspace_invitations wi
        JOIN workspaces w
          ON w.id = wi.workspace_id
        LEFT JOIN workspace_members wm
          ON wm.workspace_id = wi.workspace_id
         AND wm.user_id = $2
        WHERE lower(wi.email) = $1
          AND wi.status = 'pending'
          AND wm.id IS NULL
        ORDER BY wi.created_at DESC
      `,
      [userEmail, currentUserId]
    );

    return invitations.map((invitation) =>
      this.mapCurrentUserInvitation(invitation)
    );
  }

  async acceptCurrentUserInvitation(
    currentUserId: string,
    invitationId: string
  ): Promise<AcceptWorkspaceInvitationPayload> {
    this.validateInvitationId(invitationId);

    return this.database.transaction(async (transaction) => {
      const invitation = await transaction.queryOne<WorkspaceInvitationDetailRow>(
        `
          SELECT
            wi.id,
            wi.workspace_id,
            wi.email,
            wi.role,
            wi.token_hash,
            wi.status,
            wi.invited_by_user_id,
            wi.accepted_by_user_id,
            wi.revoked_by_user_id,
            wi.expires_at,
            wi.accepted_at,
            wi.revoked_at,
            wi.created_at,
            wi.updated_at,
            w.name AS workspace_name
          FROM workspace_invitations wi
          JOIN workspaces w
            ON w.id = wi.workspace_id
          WHERE wi.id = $1
          FOR UPDATE OF wi
        `,
        [invitationId]
      );

      if (!invitation) {
        throw notFound("Workspace invitation not found");
      }

      return this.acceptPendingInvitation(transaction, currentUserId, invitation);
    });
  }

  async rejectCurrentUserInvitation(
    currentUserId: string,
    invitationId: string
  ): Promise<WorkspaceInvitationPayload> {
    this.validateInvitationId(invitationId);

    return this.database.transaction(async (transaction) => {
      const invitation = await transaction.queryOne<WorkspaceInvitationRow>(
        `
          SELECT
            id,
            workspace_id,
            email,
            role,
            token_hash,
            status,
            invited_by_user_id,
            accepted_by_user_id,
            revoked_by_user_id,
            expires_at,
            accepted_at,
            revoked_at,
            created_at,
            updated_at
          FROM workspace_invitations
          WHERE id = $1
          FOR UPDATE
        `,
        [invitationId]
      );

      if (!invitation) {
        throw notFound("Workspace invitation not found");
      }

      if (this.shouldExpireInvitation(invitation)) {
        throw badRequest("Workspace invitation has expired");
      }

      if (invitation.status !== "pending") {
        throw badRequest("Workspace invitation is not pending");
      }

      const user = await transaction.queryOne<UserEmailRow>(
        `
          SELECT id, email
          FROM users
          WHERE id = $1
        `,
        [currentUserId]
      );
      const userEmail = user?.email?.trim().toLowerCase();

      if (!userEmail || userEmail !== invitation.email.trim().toLowerCase()) {
        throw forbidden("Workspace invitation email does not match current user");
      }

      const revokedInvitation =
        await transaction.queryOne<WorkspaceInvitationRow>(
          `
            UPDATE workspace_invitations
            SET
              status = 'revoked',
              revoked_by_user_id = $2,
              revoked_at = now()
            WHERE id = $1
              AND status = 'pending'
            RETURNING
              id,
              workspace_id,
              email,
              role,
              token_hash,
              status,
              invited_by_user_id,
              accepted_by_user_id,
              revoked_by_user_id,
              expires_at,
              accepted_at,
              revoked_at,
              created_at,
              updated_at
          `,
          [invitationId, currentUserId]
        );

      if (!revokedInvitation) {
        throw badRequest("Workspace invitation is not pending");
      }

      return this.mapInvitation(revokedInvitation);
    });
  }

  async acceptInvitation(
    currentUserId: string,
    invitationToken: string
  ): Promise<AcceptWorkspaceInvitationPayload> {
    const tokenHash = this.hashInvitationToken(invitationToken);

    return this.database.transaction(async (transaction) => {
      const invitation = await transaction.queryOne<WorkspaceInvitationDetailRow>(
        `
          SELECT
            wi.id,
            wi.workspace_id,
            wi.email,
            wi.role,
            wi.token_hash,
            wi.status,
            wi.invited_by_user_id,
            wi.accepted_by_user_id,
            wi.revoked_by_user_id,
            wi.expires_at,
            wi.accepted_at,
            wi.revoked_at,
            wi.created_at,
            wi.updated_at,
            w.name AS workspace_name
          FROM workspace_invitations wi
          JOIN workspaces w
            ON w.id = wi.workspace_id
          WHERE wi.token_hash = $1
          FOR UPDATE OF wi
        `,
        [tokenHash]
      );

      if (!invitation) {
        throw notFound("Workspace invitation not found");
      }

      return this.acceptPendingInvitation(transaction, currentUserId, invitation);
    });
  }

  private async acceptPendingInvitation(
    transaction: {
      queryOne<T extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ): Promise<T | null>;
      execute<T extends QueryResultRow = QueryResultRow>(
        text: string,
        values?: readonly unknown[]
      ): Promise<unknown>;
    },
    currentUserId: string,
    invitation: WorkspaceInvitationDetailRow
  ): Promise<AcceptWorkspaceInvitationPayload> {
    if (this.shouldExpireInvitation(invitation)) {
      await transaction.execute(
        `
          UPDATE workspace_invitations
          SET status = 'expired'
          WHERE id = $1
            AND status = 'pending'
        `,
        [invitation.id]
      );
      throw badRequest("Workspace invitation has expired");
    }

    if (invitation.status !== "pending") {
      throw badRequest("Workspace invitation is not pending");
    }

    const user = await transaction.queryOne<UserEmailRow>(
      `
        SELECT id, email
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    const userEmail = user?.email?.trim().toLowerCase();
    if (!userEmail || userEmail !== invitation.email) {
      throw forbidden("Workspace invitation email does not match current user");
    }

    const existingMembership = await transaction.queryOne<WorkspaceIdRow>(
      `
        SELECT id
        FROM workspace_members
        WHERE workspace_id = $1
          AND user_id = $2
      `,
      [invitation.workspace_id, currentUserId]
    );

    if (existingMembership) {
      throw badRequest("User is already a workspace member");
    }

    const membership = await transaction.queryOne<WorkspaceMemberRow>(
      `
        INSERT INTO workspace_members (
          workspace_id,
          user_id,
          role,
          invited_by_user_id,
          joined_at
        )
        VALUES ($1, $2, 'member', $3, now())
        RETURNING
          id,
          workspace_id,
          user_id,
          role,
          invited_by_user_id,
          joined_at,
          created_at,
          updated_at,
          NULL::text AS user_name,
          $4::text AS user_email,
          NULL::text AS user_job_title,
          NULL::text AS user_bio,
          NULL::text AS user_avatar_url,
          NULL::uuid AS user_active_workspace_id,
          NULL::timestamptz AS user_last_seen_at
      `,
      [
        invitation.workspace_id,
        currentUserId,
        invitation.invited_by_user_id,
        userEmail
      ]
    );

    if (!membership) {
      throw new Error("Workspace membership could not be created");
    }

    await transaction.execute(
      `
        UPDATE workspace_invitations
        SET
          status = 'accepted',
          accepted_by_user_id = $2,
          accepted_at = now()
        WHERE id = $1
      `,
      [invitation.id, currentUserId]
    );

    const workspace = await transaction.queryOne<WorkspaceRow>(
      `
        SELECT
          w.id,
          w.name,
          w.icon,
          w.owner_user_id,
          wm.role,
          w.created_at,
          w.updated_at
        FROM workspaces w
        JOIN workspace_members wm
          ON wm.workspace_id = w.id
         AND wm.user_id = $2
        WHERE w.id = $1
      `,
      [invitation.workspace_id, currentUserId]
    );

    if (!workspace) {
      throw new Error("Accepted workspace could not be loaded");
    }

    return {
      workspace: this.mapWorkspace(workspace, currentUserId),
      membership: this.mapMember(membership)
    };
  }

  private async findWorkspaceForUser(
    currentUserId: string,
    workspaceId: string
  ): Promise<WorkspaceRow | null> {
    if (!UUID_PATTERN.test(workspaceId)) {
      return null;
    }

    return this.database.queryOne<WorkspaceRow>(
      `
        SELECT
          w.id,
          w.name,
          w.icon,
          w.owner_user_id,
          wm.role,
          w.created_at,
          w.updated_at
        FROM workspaces w
        LEFT JOIN workspace_members wm
          ON wm.workspace_id = w.id
         AND wm.user_id = $2
        WHERE w.id = $1
      `,
      [workspaceId, currentUserId]
    );
  }

  private async publishMembershipRevocation(
    workspaceId: string,
    userId: string
  ): Promise<void> {
    try {
      await this.membershipRevocationPublisher.publishMembershipRevoked(
        workspaceId,
        userId
      );
    } catch {
      // The publisher logs Redis failures. Membership removal remains committed.
    }
  }

  private async findInvitationByToken(
    invitationToken: string
  ): Promise<WorkspaceInvitationDetailRow | null> {
    const tokenHash = this.hashInvitationToken(invitationToken);

    return this.database.queryOne<WorkspaceInvitationDetailRow>(
      `
        SELECT
          wi.id,
          wi.workspace_id,
          wi.email,
          wi.role,
          wi.token_hash,
          wi.status,
          wi.invited_by_user_id,
          wi.accepted_by_user_id,
          wi.revoked_by_user_id,
          wi.expires_at,
          wi.accepted_at,
          wi.revoked_at,
          wi.created_at,
          wi.updated_at,
          w.name AS workspace_name
        FROM workspace_invitations wi
        JOIN workspaces w
          ON w.id = wi.workspace_id
        WHERE wi.token_hash = $1
      `,
      [tokenHash]
    );
  }

  private async expirePendingInvitationsForWorkspace(
    workspaceId: string
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE workspace_invitations
        SET status = 'expired'
        WHERE workspace_id = $1
          AND status = 'pending'
          AND expires_at <= now()
      `,
      [workspaceId]
    );
  }

  private async expirePendingInvitationsForEmail(
    workspaceId: string,
    email: string
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE workspace_invitations
        SET status = 'expired'
        WHERE workspace_id = $1
          AND lower(email) = $2
          AND status = 'pending'
          AND expires_at <= now()
      `,
      [workspaceId, email]
    );
  }

  private async expirePendingInvitationsForUserEmail(email: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE workspace_invitations
        SET status = 'expired'
        WHERE lower(email) = $1
          AND status = 'pending'
          AND expires_at <= now()
      `,
      [email]
    );
  }

  private async resolveInvitationExpiration(
    invitation: WorkspaceInvitationDetailRow
  ): Promise<WorkspaceInvitationDetailRow> {
    if (!this.shouldExpireInvitation(invitation)) {
      return invitation;
    }

    const expiredInvitation = await this.markInvitationExpired(invitation.id);

    return {
      ...invitation,
      status: expiredInvitation?.status ?? "expired"
    };
  }

  private async markInvitationExpired(
    invitationId: string
  ): Promise<WorkspaceInvitationRow | null> {
    return this.database.queryOne<WorkspaceInvitationRow>(
      `
        UPDATE workspace_invitations
        SET status = 'expired'
        WHERE id = $1
          AND status = 'pending'
        RETURNING
          id,
          workspace_id,
          email,
          role,
          token_hash,
          status,
          invited_by_user_id,
          accepted_by_user_id,
          revoked_by_user_id,
          expires_at,
          accepted_at,
          revoked_at,
          created_at,
          updated_at
      `,
      [invitationId]
    );
  }

  private mapWorkspace(
    workspace: WorkspaceRow,
    currentUserId: string
  ): WorkspacePayload {
    if (!workspace.role) {
      throw forbidden("Workspace access denied");
    }

    return {
      id: workspace.id,
      name: workspace.name,
      icon: workspace.icon,
      ownerUserId: workspace.owner_user_id,
      role: workspace.role,
      isOwner: workspace.role === "owner" || workspace.owner_user_id === currentUserId,
      createdAt: this.toIsoString(workspace.created_at),
      updatedAt: this.toIsoString(workspace.updated_at)
    };
  }

  private mapMember(member: WorkspaceMemberRow): WorkspaceMemberPayload {
    return {
      id: member.id,
      workspaceId: member.workspace_id,
      userId: member.user_id,
      role: member.role,
      invitedByUserId: member.invited_by_user_id,
      joinedAt: this.toIsoString(member.joined_at),
      createdAt: this.toIsoString(member.created_at),
      updatedAt: this.toIsoString(member.updated_at),
      user: {
        id: member.user_id,
        name: member.user_name,
        email: member.user_email,
        jobTitle: member.user_job_title,
        bio: member.user_bio,
        avatarUrl: member.user_avatar_url,
        activeWorkspaceId: member.user_active_workspace_id,
        lastSeenAt: this.toNullableIsoString(member.user_last_seen_at)
      }
    };
  }

  private mapInvitation(
    invitation: WorkspaceInvitationRow
  ): WorkspaceInvitationPayload {
    return {
      id: invitation.id,
      workspaceId: invitation.workspace_id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedByUserId: invitation.invited_by_user_id,
      acceptedByUserId: invitation.accepted_by_user_id,
      revokedByUserId: invitation.revoked_by_user_id,
      expiresAt: this.toIsoString(invitation.expires_at),
      acceptedAt: this.toNullableIsoString(invitation.accepted_at),
      revokedAt: this.toNullableIsoString(invitation.revoked_at),
      createdAt: this.toIsoString(invitation.created_at),
      updatedAt: this.toIsoString(invitation.updated_at)
    };
  }

  private mapCurrentUserInvitation(
    invitation: WorkspaceInvitationDetailRow
  ): CurrentUserWorkspaceInvitationPayload {
    return {
      id: invitation.id,
      workspaceId: invitation.workspace_id,
      workspaceName: invitation.workspace_name,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedByUserId: invitation.invited_by_user_id,
      expiresAt: this.toIsoString(invitation.expires_at),
      createdAt: this.toIsoString(invitation.created_at)
    };
  }

  private readInvitationEmail(value: unknown): string {
    if (typeof value !== "string") {
      throw badRequest("Invitation email is required");
    }

    const email = value.trim().toLowerCase();

    if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
      throw badRequest("Invitation email is invalid");
    }

    return email;
  }

  private readWorkspaceName(value: unknown): string {
    if (typeof value !== "string") {
      throw badRequest("Workspace name is required");
    }

    const name = value.trim();
    if (!name || name.length > 100) {
      throw badRequest("Workspace name must be between 1 and 100 characters");
    }

    return name;
  }

  private readWorkspaceIcon(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw badRequest("Workspace icon must be a string");
    }

    const icon = value.trim();
    if (!icon || icon.length > 32) {
      throw badRequest("Workspace icon must be between 1 and 32 characters");
    }

    return icon;
  }

  private readInvitationRole(value: unknown): WorkspaceRole {
    if (value === undefined || value === null || value === "member") {
      return "member";
    }

    throw badRequest("Workspace invitation role must be member");
  }

  private validateUserId(userId: string): void {
    if (!UUID_PATTERN.test(userId)) {
      throw badRequest("Workspace member user id is invalid");
    }
  }

  private validateInvitationId(invitationId: string): void {
    if (!UUID_PATTERN.test(invitationId)) {
      throw badRequest("Workspace invitation id is invalid");
    }
  }

  private shouldExpireInvitation(invitation: WorkspaceInvitationRow): boolean {
    return (
      invitation.status === "pending" &&
      new Date(invitation.expires_at).getTime() <= Date.now()
    );
  }

  private createInvitationToken(): string {
    return `pilo_inv_${randomBytes(INVITATION_TOKEN_BYTE_LENGTH).toString("base64url")}`;
  }

  private hashInvitationToken(invitationToken: string): string {
    return createHash("sha256").update(invitationToken, "utf8").digest("hex");
  }

  private buildInvitationAcceptUrl(invitationToken: string): string {
    const frontendOrigin = (
      process.env.FRONTEND_URL ?? FRONTEND_DEFAULT_ORIGIN
    ).replace(/\/+$/, "");

    return `${frontendOrigin}/invitations/accept?token=${encodeURIComponent(
      invitationToken
    )}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    );
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    return value === null ? null : this.toIsoString(value);
  }
}
