import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { badRequest, conflict, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MEETING_NOTIFICATION_REDIS_CHANNEL = "meeting:notification-events";

type MeetingNotificationType =
  | "meeting_report_completed"
  | "meeting_invitation";

type MeetingInvitationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "CANCELLED";

export type MeetingNotificationPayload = {
  id: string;
  type: MeetingNotificationType;
  message: string;
  title: string | null;
  readAt: string | null;
  createdAt: string;
  workspaceId: string;
  meetingId: string;
  reportId: string | null;
  invitation: {
    id: string;
    status: MeetingInvitationStatus;
    inviterName: string;
    canRespond: boolean;
  } | null;
  canOpenReport: boolean;
};

export type MeetingInvitationAcceptancePayload = {
  invitationId: string;
  meetingId: string;
  workspaceId: string;
  meetingRoomId: string;
};

type NotificationRow = {
  id: string;
  type: MeetingNotificationType;
  message: string;
  title: string | null;
  read_at: Date | string | null;
  created_at: Date | string;
  workspace_id: string;
  meeting_id: string;
  report_id: string | null;
  can_open_report: boolean;
  invitation_id: string | null;
  invitation_status: MeetingInvitationStatus | null;
  inviter_name: string | null;
  meeting_ended_at: Date | string | null;
};

@Injectable()
export class MeetingNotificationService implements OnModuleDestroy {
  private readonly logger = new Logger(MeetingNotificationService.name);
  private client: RedisClientType | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listNotifications(currentUserId: string): Promise<{
    items: MeetingNotificationPayload[];
    unreadCount: number;
  }> {
    const rows = await this.database.query<NotificationRow>(
      `
        SELECT
          notification.id,
          notification.type,
          notification.message,
          notification.title,
          notification.read_at,
          notification.created_at,
          notification.workspace_id,
          notification.meeting_id,
          notification.report_id,
          notification.can_open_report,
          invitation.id AS invitation_id,
          invitation.status AS invitation_status,
          inviter.name AS inviter_name,
          meeting.ended_at AS meeting_ended_at
        FROM meeting_notifications AS notification
        LEFT JOIN meeting_invitations AS invitation
          ON invitation.id = notification.invitation_id
        LEFT JOIN users AS inviter
          ON inviter.id = invitation.inviter_user_id
        LEFT JOIN meetings AS meeting
          ON meeting.id = notification.meeting_id
        WHERE notification.recipient_user_id = $1::uuid
        ORDER BY notification.created_at DESC, notification.id DESC
        LIMIT 100
      `,
      [currentUserId]
    );
    const items = rows.map((row) => this.mapNotification(row));
    return {
      items,
      unreadCount: items.filter((item) => item.readAt === null).length
    };
  }

  async readNotification(
    currentUserId: string,
    notificationId: string
  ): Promise<MeetingNotificationPayload> {
    const id = this.requireUuid(notificationId, "notificationId");
    const row = await this.database.queryOne<NotificationRow>(
      `
        WITH updated AS (
          UPDATE meeting_notifications
          SET read_at = COALESCE(read_at, now())
          WHERE id = $1::uuid
            AND recipient_user_id = $2::uuid
          RETURNING *
        )
        SELECT
          notification.id, notification.type, notification.message, notification.title,
          notification.read_at, notification.created_at, notification.workspace_id,
          notification.meeting_id, notification.report_id, notification.can_open_report,
          invitation.id AS invitation_id, invitation.status AS invitation_status,
          inviter.name AS inviter_name, meeting.ended_at AS meeting_ended_at
        FROM updated AS notification
        LEFT JOIN meeting_invitations AS invitation ON invitation.id = notification.invitation_id
        LEFT JOIN users AS inviter ON inviter.id = invitation.inviter_user_id
        LEFT JOIN meetings AS meeting ON meeting.id = notification.meeting_id
      `,
      [id, currentUserId]
    );
    if (!row) throw notFound("Meeting notification not found");
    return this.mapNotification(row);
  }

  async createInvitation(
    currentUserId: string,
    workspaceId: string,
    meetingId: string,
    body: unknown
  ): Promise<{ invitationId: string; status: "PENDING" }> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const inviteeUserId = this.readInviteeUserId(body);
    const normalizedMeetingId = this.requireUuid(meetingId, "meetingId");
    if (inviteeUserId === currentUserId) {
      throw badRequest("You cannot invite yourself to a Meeting");
    }

    const result = await this.database.transaction(async (transaction) => {
      const meeting = await transaction.queryOne<{ id: string; room_name: string }>(
        `
          SELECT meeting.id, room.name AS room_name
          FROM meetings AS meeting
          JOIN meeting_rooms AS room ON room.workspace_id = meeting.workspace_id
            AND room.room_key = meeting.room_key
          WHERE meeting.id = $1::uuid
            AND meeting.workspace_id = $2::uuid
            AND meeting.ended_at IS NULL
          FOR UPDATE OF meeting
        `,
        [normalizedMeetingId, workspaceId]
      );
      if (!meeting) throw notFound("Active Meeting not found");

      const inviterIsActive = await transaction.queryOne<{ user_id: string }>(
        `SELECT user_id FROM meeting_participants
         WHERE meeting_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL
         LIMIT 1 FOR UPDATE`,
        [normalizedMeetingId, currentUserId]
      );
      if (!inviterIsActive) {
        throw conflict("Only an active Meeting participant can send invitations");
      }

      const inviteeIsMember = await transaction.queryOne<{ user_id: string }>(
        `SELECT user_id FROM workspace_members
         WHERE workspace_id = $1::uuid AND user_id = $2::uuid`,
        [workspaceId, inviteeUserId]
      );
      if (!inviteeIsMember) throw notFound("Workspace member not found");

      const inviteeIsActive = await transaction.queryOne<{ user_id: string }>(
        `SELECT user_id FROM meeting_participants
         WHERE meeting_id = $1::uuid AND user_id = $2::uuid AND left_at IS NULL
         LIMIT 1`,
        [normalizedMeetingId, inviteeUserId]
      );
      if (inviteeIsActive) {
        throw conflict("Workspace member is already in this Meeting");
      }

      const invitation = await transaction.queryOne<{ id: string; status: MeetingInvitationStatus }>(
        `
          INSERT INTO meeting_invitations (
            workspace_id, meeting_id, inviter_user_id, invitee_user_id
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
          ON CONFLICT (meeting_id, invitee_user_id) WHERE status = 'PENDING'
          DO UPDATE SET inviter_user_id = EXCLUDED.inviter_user_id
          RETURNING id, status
        `,
        [workspaceId, normalizedMeetingId, currentUserId, inviteeUserId]
      );
      if (!invitation) throw new Error("Meeting invitation upsert failed");

      const inviter = await transaction.queryOne<{ name: string | null }>(
        `SELECT name FROM users WHERE id = $1::uuid`,
        [currentUserId]
      );
      const notification = await transaction.queryOne<{ id: string }>(
        `
          INSERT INTO meeting_notifications (
            recipient_user_id, workspace_id, meeting_id, invitation_id,
            type, title, message
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid,
            'meeting_invitation', '음성회의 초대', $5
          )
          ON CONFLICT (invitation_id, recipient_user_id)
            WHERE type = 'meeting_invitation'
          DO UPDATE SET
            read_at = NULL,
            terminal_at = NULL,
            created_at = now(),
            message = EXCLUDED.message
          RETURNING id
        `,
        [
          inviteeUserId,
          workspaceId,
          normalizedMeetingId,
          invitation.id,
          `${inviter?.name?.trim() || "Workspace 사용자"}님이 ${meeting.room_name} 회의에 초대했습니다.`
        ]
      );
      if (!notification) throw new Error("Meeting invitation notification upsert failed");
      return { invitation, notificationId: notification.id };
    });

    await this.publishNotificationSafely(result.notificationId, inviteeUserId);
    return { invitationId: result.invitation.id, status: "PENDING" };
  }

  async acceptInvitation(
    currentUserId: string,
    invitationId: string
  ): Promise<MeetingInvitationAcceptancePayload> {
    return this.respondToInvitation(currentUserId, invitationId, "ACCEPTED");
  }

  async declineInvitation(
    currentUserId: string,
    invitationId: string
  ): Promise<{ invitationId: string; status: "DECLINED" }> {
    const result = await this.respondToInvitation(currentUserId, invitationId, "DECLINED");
    return { invitationId: result.invitationId, status: "DECLINED" };
  }

  async createReportCompletedNotifications(reportId: string): Promise<void> {
    const id = this.requireUuid(reportId, "reportId");
    const rows = await this.database.query<{ id: string; recipient_user_id: string }>(
      `
        WITH report AS (
          SELECT report.id, report.meeting_id, meeting.workspace_id
          FROM meeting_reports AS report
          JOIN meetings AS meeting ON meeting.id = report.meeting_id
          WHERE report.id = $1::uuid AND report.status = 'COMPLETED'
        ), recipients AS (
          SELECT DISTINCT participant.user_id
          FROM meeting_participants AS participant
          JOIN report ON report.meeting_id = participant.meeting_id
        )
        INSERT INTO meeting_notifications (
          recipient_user_id, workspace_id, meeting_id, report_id,
          type, can_open_report, title, message
        )
        SELECT
          recipients.user_id,
          report.workspace_id,
          report.meeting_id,
          report.id,
          'meeting_report_completed',
          EXISTS (
            SELECT 1 FROM workspace_members AS member
            WHERE member.workspace_id = report.workspace_id
              AND member.user_id = recipients.user_id
          ),
          CASE WHEN EXISTS (
            SELECT 1 FROM workspace_members AS member
            WHERE member.workspace_id = report.workspace_id
              AND member.user_id = recipients.user_id
          ) THEN '회의록이 완성되었습니다.' ELSE NULL END,
          CASE WHEN EXISTS (
            SELECT 1 FROM workspace_members AS member
            WHERE member.workspace_id = report.workspace_id
              AND member.user_id = recipients.user_id
          ) THEN '참여한 회의의 회의록을 확인할 수 있습니다.'
          ELSE '참여했던 회의의 회의록이 완성되었습니다.' END
        FROM report CROSS JOIN recipients
        ON CONFLICT (report_id, recipient_user_id)
          WHERE type = 'meeting_report_completed'
        DO NOTHING
        RETURNING id, recipient_user_id
      `,
      [id]
    );
    await Promise.all(rows.map((row) => this.publishNotificationSafely(row.id, row.recipient_user_id)));
  }

  async cancelPendingInvitationsForMeeting(meetingId: string): Promise<void> {
    if (!UUID_PATTERN.test(meetingId)) return;
    const notifications = await this.database.query<{
      id: string;
      recipient_user_id: string;
    }>(
      `
        WITH cancelled AS (
          UPDATE meeting_invitations
          SET status = 'CANCELLED', cancelled_at = now()
          WHERE meeting_id = $1::uuid AND status = 'PENDING'
          RETURNING id
        )
        UPDATE meeting_notifications
        SET terminal_at = now()
        WHERE invitation_id IN (SELECT id FROM cancelled)
          AND terminal_at IS NULL
        RETURNING id, recipient_user_id
      `,
      [meetingId]
    );
    await Promise.all(
      notifications.map((notification) =>
        this.publishNotificationSafely(
          notification.id,
          notification.recipient_user_id,
          "updated"
        )
      )
    );
  }

  async cancelInvitation(
    currentUserId: string,
    workspaceId: string,
    meetingId: string,
    invitationId: string
  ): Promise<{ invitationId: string; status: "CANCELLED" }> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const id = this.requireUuid(invitationId, "invitationId");
    const result = await this.database.transaction(async (transaction) => {
      const invitation = await transaction.queryOne<{ id: string }>(
        `SELECT id FROM meeting_invitations
         WHERE id = $1::uuid AND workspace_id = $2::uuid AND meeting_id = $3::uuid
           AND inviter_user_id = $4::uuid
         FOR UPDATE`,
        [id, workspaceId, meetingId, currentUserId]
      );
      if (!invitation) throw notFound("Meeting invitation not found");
      const cancelled = await transaction.queryOne<{ id: string }>(
        `UPDATE meeting_invitations
         SET status = 'CANCELLED', cancelled_at = now()
         WHERE id = $1::uuid AND status = 'PENDING'
         RETURNING id`,
        [id]
      );
      if (!cancelled) throw conflict("Meeting invitation is no longer available");
      await transaction.execute(
        `UPDATE meeting_notifications
         SET terminal_at = now()
         WHERE invitation_id = $1::uuid AND terminal_at IS NULL`,
        [id]
      );
      return cancelled;
    });
    return { invitationId: result.id, status: "CANCELLED" };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    this.client = null;
  }

  private async respondToInvitation(
    currentUserId: string,
    invitationId: string,
    status: "ACCEPTED" | "DECLINED"
  ): Promise<MeetingInvitationAcceptancePayload> {
    const id = this.requireUuid(invitationId, "invitationId");
    const result = await this.database.transaction(async (transaction) => {
      const invitation = await transaction.queryOne<{
        id: string;
        workspace_id: string;
        meeting_id: string;
        meeting_room_id: string;
        status: MeetingInvitationStatus;
        ended_at: Date | string | null;
      }>(
        `
          SELECT invitation.id, invitation.workspace_id, invitation.meeting_id,
            room.id AS meeting_room_id, invitation.status, meeting.ended_at
          FROM meeting_invitations AS invitation
          JOIN meetings AS meeting ON meeting.id = invitation.meeting_id
          JOIN meeting_rooms AS room ON room.workspace_id = meeting.workspace_id
            AND room.room_key = meeting.room_key
          WHERE invitation.id = $1::uuid AND invitation.invitee_user_id = $2::uuid
          FOR UPDATE OF invitation
        `,
        [id, currentUserId]
      );
      if (!invitation) throw notFound("Meeting invitation not found");
      if (invitation.status !== "PENDING" || invitation.ended_at !== null) {
        throw conflict("Meeting invitation is no longer available");
      }
      const member = await transaction.queryOne<{ user_id: string }>(
        `SELECT user_id FROM workspace_members
         WHERE workspace_id = $1::uuid AND user_id = $2::uuid`,
        [invitation.workspace_id, currentUserId]
      );
      if (!member) throw notFound("Meeting invitation not found");
      await transaction.execute(
        `UPDATE meeting_invitations
         SET status = $3, responded_at = now()
         WHERE id = $1::uuid AND invitee_user_id = $2::uuid`,
        [id, currentUserId, status]
      );
      await transaction.execute(
        `UPDATE meeting_notifications
         SET terminal_at = now(), read_at = COALESCE(read_at, now())
         WHERE invitation_id = $1::uuid AND recipient_user_id = $2::uuid`,
        [id, currentUserId]
      );
      return invitation;
    });
    return {
      invitationId: id,
      workspaceId: result.workspace_id,
      meetingId: result.meeting_id,
      meetingRoomId: result.meeting_room_id
    };
  }

  private mapNotification(row: NotificationRow): MeetingNotificationPayload {
    const canRespond =
      row.type === "meeting_invitation" &&
      row.invitation_status === "PENDING" &&
      row.meeting_ended_at === null;
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      workspaceId: row.workspace_id,
      meetingId: row.meeting_id,
      reportId: row.report_id,
      canOpenReport: Boolean(row.can_open_report),
      invitation:
        row.invitation_id && row.invitation_status
          ? {
              id: row.invitation_id,
              status: row.invitation_status,
              inviterName: row.inviter_name?.trim() || "Workspace 사용자",
              canRespond
            }
          : null
    };
  }

  private readInviteeUserId(body: unknown): string {
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { inviteeUserId?: unknown }).inviteeUserId !== "string"
    ) {
      throw badRequest("Meeting invitation payload is invalid");
    }
    return this.requireUuid(
      (body as { inviteeUserId: string }).inviteeUserId,
      "inviteeUserId"
    );
  }

  private requireUuid(value: string, field: string): string {
    if (!UUID_PATTERN.test(value)) throw badRequest(`${field} is invalid`);
    return value;
  }

  private async publishNotificationSafely(
    notificationId: string,
    recipientUserId: string,
    change: "created" | "updated" = "created"
  ): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;
      await client.publish(
        MEETING_NOTIFICATION_REDIS_CHANNEL,
        JSON.stringify({
          event: `meeting:notification:${change}`,
          notificationId,
          recipientUserId,
          occurredAt: new Date().toISOString()
        })
      );
    } catch {
      this.logger.warn(`Meeting notification realtime publish failed notification_id=${notificationId}`);
    }
  }

  private async getClient(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.client) return this.client;
    const client = createClient({ url });
    client.on("error", (error) =>
      this.logger.error("Meeting notification Redis publish failed", error)
    );
    await client.connect();
    this.client = client as RedisClientType;
    return this.client;
  }
}
