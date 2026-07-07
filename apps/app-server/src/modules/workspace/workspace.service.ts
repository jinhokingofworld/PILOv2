import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, forbidden, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

export type WorkspaceRole = "owner" | "member";
type WorkspaceInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
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
  user_avatar_url: string | null;
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

export interface WorkspacePayload {
  id: string;
  name: string;
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
    avatarUrl: string | null;
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
const DEFAULT_WORKSPACE_NAME_BYTE_LENGTH = 4;
const INVITATION_TOKEN_BYTE_LENGTH = 32;
const DEFAULT_INVITATION_TTL_DAYS = 7;
const FRONTEND_DEFAULT_ORIGIN = "http://localhost:3000";

@Injectable()
export class WorkspaceService {
  constructor(private readonly database: DatabaseService) {}

  async ensureDefaultWorkspaceForUser(userId: string): Promise<void> {
    const workspaceName = `PILO-${randomBytes(DEFAULT_WORKSPACE_NAME_BYTE_LENGTH).toString("hex")}`;

    await this.database.transaction(async (transaction) => {
      const existingWorkspace = await transaction.queryOne<WorkspaceIdRow>(
        `
          SELECT id
          FROM workspaces
          WHERE owner_user_id = $1
          ORDER BY created_at ASC
          LIMIT 1
        `,
        [userId]
      );

      const workspace =
        existingWorkspace ??
        (await transaction.queryOne<WorkspaceIdRow>(
          `
            INSERT INTO workspaces (name, owner_user_id)
            VALUES ($1, $2)
            ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL
            DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id
            RETURNING id
          `,
          [workspaceName, userId]
        ));

      if (!workspace) {
        throw new Error("Default workspace could not be initialized");
      }

      await transaction.execute(
        `
          INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
          VALUES ($1, $2, 'owner', now())
          ON CONFLICT (workspace_id, user_id)
          DO UPDATE SET role = 'owner', invited_by_user_id = NULL
        `,
        [workspace.id, userId]
      );
    });
  }

  async listWorkspaces(currentUserId: string): Promise<WorkspacePayload[]> {
    const workspaces = await this.database.query<WorkspaceRow>(
      `
        SELECT
          w.id,
          w.name,
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
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);

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
          u.name AS user_name,
          u.email AS user_email,
          u.avatar_url AS user_avatar_url
        FROM workspace_members wm
        JOIN users u
          ON u.id = wm.user_id
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
            u.name AS user_name,
            u.email AS user_email,
            u.avatar_url AS user_avatar_url
          FROM workspace_members wm
          JOIN users u
            ON u.id = wm.user_id
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

  async revokeInvitation(
    currentUserId: string,
    workspaceId: string,
    invitationId: string
  ): Promise<WorkspaceInvitationPayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    this.validateInvitationId(invitationId);

    const invitation = await this.database.queryOne<WorkspaceInvitationRow>(
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
          AND id = $2
      `,
      [workspaceId, invitationId]
    );

    if (!invitation) {
      throw notFound("Workspace invitation not found");
    }

    if (this.shouldExpireInvitation(invitation)) {
      const expiredInvitation = await this.markInvitationExpired(invitation.id);
      throw badRequest(
        expiredInvitation
          ? "Workspace invitation has expired"
          : "Workspace invitation is not pending"
      );
    }

    if (invitation.status !== "pending") {
      throw badRequest("Workspace invitation is not pending");
    }

    const revokedInvitation = await this.database.queryOne<WorkspaceInvitationRow>(
      `
        UPDATE workspace_invitations
        SET
          status = 'revoked',
          revoked_by_user_id = $3,
          revoked_at = now()
        WHERE workspace_id = $1
          AND id = $2
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
      [workspaceId, invitationId, currentUserId]
    );

    if (!revokedInvitation) {
      throw notFound("Workspace invitation not found");
    }

    return this.mapInvitation(revokedInvitation);
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
            NULL::text AS user_avatar_url
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
    });
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
        avatarUrl: member.user_avatar_url
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
