import { randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { forbidden } from "../../common/api-error";
import {
  type WorkspaceMemberPayload,
  WorkspaceService
} from "../workspace/workspace.service";
import {
  screenShareAlreadyActive,
  screenShareNotFound
} from "./screen-share.errors";
import { ScreenShareRealtimePublisherService } from "./screen-share-realtime-publisher.service";
import { ScreenShareRoomService } from "./screen-share-room.service";
import { ScreenShareStateService } from "./screen-share-state.service";
import {
  ScreenShareTokenService,
  type ScreenShareTokenPayload
} from "./screen-share-token.service";
import type {
  PublicWorkspaceScreenShareSession,
  WorkspaceScreenShareSession
} from "./screen-share.types";

export type CurrentWorkspaceScreenSharePayload = {
  session: PublicWorkspaceScreenShareSession | null;
};

export type StartWorkspaceScreenSharePayload = ScreenShareTokenPayload & {
  id: string;
  status: "starting";
  sharer: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  startedAt: null;
};

export type EndWorkspaceScreenSharePayload = {
  sessionId: string;
  ended: true;
};

@Injectable()
export class ScreenShareService {
  private readonly startHttpStatuses = new WeakMap<
    StartWorkspaceScreenSharePayload,
    HttpStatus
  >();

  constructor(
    private readonly state: ScreenShareStateService,
    private readonly tokens: ScreenShareTokenService,
    private readonly rooms: ScreenShareRoomService,
    private readonly realtime: ScreenShareRealtimePublisherService,
    private readonly workspaces: WorkspaceService
  ) {}

  async getCurrent(
    userId: string,
    workspaceId: string
  ): Promise<CurrentWorkspaceScreenSharePayload> {
    await this.workspaces.assertWorkspaceAccess(userId, workspaceId);
    const current = await this.state.getCurrent(workspaceId);
    if (!current || current.status === "starting") {
      return { session: null };
    }

    if (await this.rooms.hasActiveScreenTrack(current)) {
      return { session: this.toPublicSession(current) };
    }

    await this.endStaleSession(current);
    return { session: null };
  }

  async start(
    userId: string,
    workspaceId: string
  ): Promise<StartWorkspaceScreenSharePayload> {
    const members = await this.workspaces.listMembers(userId, workspaceId);
    const member = members.find(item => item.userId === userId);
    if (!member) throw forbidden("Workspace access denied");

    const candidate = this.createSession(member, workspaceId);
    const rollbackAttemptId = candidate.sessionId;
    if (await this.state.reserve(candidate, rollbackAttemptId)) {
      return this.issueNewPublisherToken(candidate, rollbackAttemptId);
    }

    const current = await this.state.getCurrent(workspaceId);
    if (!current) throw screenShareAlreadyActive();

    if (current.status === "starting") {
      return this.recoverStartingSession(
        userId,
        current,
        rollbackAttemptId
      );
    }

    if (await this.rooms.hasActiveScreenTrack(current)) {
      throw screenShareAlreadyActive(this.toPublicSession(current));
    }

    const ended = await this.endStaleSession(current);
    if (!ended) {
      return this.resolveReservationWinner(
        userId,
        workspaceId,
        rollbackAttemptId
      );
    }

    if (await this.state.reserve(candidate, rollbackAttemptId)) {
      return this.issueNewPublisherToken(candidate, rollbackAttemptId);
    }

    return this.resolveReservationWinner(
      userId,
      workspaceId,
      rollbackAttemptId
    );
  }

  async createViewerToken(
    userId: string,
    workspaceId: string,
    sessionId: string
  ): Promise<ScreenShareTokenPayload> {
    await this.workspaces.assertWorkspaceAccess(userId, workspaceId);
    const current = await this.state.getCurrent(workspaceId);
    if (
      !current ||
      current.sessionId !== sessionId ||
      current.status !== "active"
    ) {
      throw screenShareNotFound();
    }

    if (!(await this.rooms.hasActiveScreenTrack(current))) {
      await this.endStaleSession(current);
      throw screenShareNotFound();
    }

    return this.tokens.createViewerToken({
      identity: `screen-share-viewer:${sessionId}:${userId}:${this.createUuid()}`,
      roomName: current.livekitRoomName,
      participantName: userId
    });
  }

  async end(
    userId: string,
    workspaceId: string,
    sessionId: string
  ): Promise<EndWorkspaceScreenSharePayload> {
    await this.workspaces.assertWorkspaceAccess(userId, workspaceId);
    const current = await this.state.getCurrent(workspaceId);
    const payload: EndWorkspaceScreenSharePayload = {
      sessionId,
      ended: true
    };

    if (!current || current.sessionId !== sessionId) return payload;
    if (current.sharerUserId !== userId) {
      throw forbidden("Only the screen sharer can end this session");
    }

    await this.publishEnded(current);
    const ended = await this.state.endIfCurrent({
      workspaceId,
      sessionId,
      livekitRoomName: current.livekitRoomName
    });
    if (!ended) return payload;

    await this.cleanupRoom(ended);
    return payload;
  }

  async endForRevocation(
    workspaceId: string,
    userId: string
  ): Promise<boolean> {
    const current = await this.state.getCurrent(workspaceId);
    if (!current || current.sharerUserId !== userId) return false;

    await this.publishEnded(current);
    const ended = await this.state.endIfCurrent({
      workspaceId,
      sessionId: current.sessionId,
      livekitRoomName: current.livekitRoomName
    });
    if (!ended) return false;

    try {
      await this.rooms.removeParticipantForRevocation(ended);
    } catch {
      // Redis no longer exposes the revoked publisher session.
    }
    try {
      await this.rooms.deleteRoom(ended);
    } catch {
      // The publisher token is revoked and Redis no longer exposes the session.
    }
    return true;
  }

  getStartHttpStatus(payload: StartWorkspaceScreenSharePayload): HttpStatus {
    return this.startHttpStatuses.get(payload) ?? HttpStatus.CREATED;
  }

  protected createUuid(): string {
    return randomUUID();
  }

  protected now(): Date {
    return new Date();
  }

  private createSession(
    member: WorkspaceMemberPayload,
    workspaceId: string
  ): WorkspaceScreenShareSession {
    const id = this.createUuid();
    return {
      sessionId: id,
      workspaceId,
      sharerUserId: member.userId,
      sharerDisplayName: this.displayName(member),
      sharerAvatarUrl: member.user.avatarUrl,
      sharerLiveKitIdentity: `screen-share:${id}:${member.userId}`,
      livekitRoomName: `pilo-screen-share-${id}`,
      status: "starting",
      createdAt: this.now().toISOString(),
      startedAt: null
    };
  }

  private displayName(member: WorkspaceMemberPayload): string {
    return member.user.name?.trim() || member.user.email?.trim() || "PILO";
  }

  private async recoverStartingSession(
    userId: string,
    session: WorkspaceScreenShareSession,
    rollbackAttemptId: string
  ): Promise<StartWorkspaceScreenSharePayload> {
    if (session.sharerUserId !== userId) throw screenShareAlreadyActive();
    const claimed = await this.state.claimStartingReservation({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName,
      rollbackAttemptId
    });
    if (!claimed) throw screenShareAlreadyActive();
    return this.issuePublisherToken(session, HttpStatus.OK);
  }

  private async resolveReservationWinner(
    userId: string,
    workspaceId: string,
    rollbackAttemptId: string
  ): Promise<StartWorkspaceScreenSharePayload> {
    const current = await this.state.getCurrent(workspaceId);
    if (!current) throw screenShareAlreadyActive();
    if (current.status === "starting") {
      return this.recoverStartingSession(
        userId,
        current,
        rollbackAttemptId
      );
    }
    throw screenShareAlreadyActive(this.toPublicSession(current));
  }

  private async issuePublisherToken(
    session: WorkspaceScreenShareSession,
    status: HttpStatus.CREATED | HttpStatus.OK
  ): Promise<StartWorkspaceScreenSharePayload> {
    const livekit = await this.tokens.createPublisherToken({
      identity: session.sharerLiveKitIdentity,
      roomName: session.livekitRoomName,
      participantName: session.sharerDisplayName
    });
    const payload: StartWorkspaceScreenSharePayload = {
      id: session.sessionId,
      status: "starting",
      sharer: {
        userId: session.sharerUserId,
        displayName: session.sharerDisplayName,
        avatarUrl: session.sharerAvatarUrl
      },
      startedAt: null,
      ...livekit
    };
    this.startHttpStatuses.set(payload, status);
    return payload;
  }

  private async issueNewPublisherToken(
    session: WorkspaceScreenShareSession,
    rollbackAttemptId: string
  ): Promise<StartWorkspaceScreenSharePayload> {
    try {
      return await this.issuePublisherToken(session, HttpStatus.CREATED);
    } catch (error) {
      try {
        await this.state.releaseStartingIfCurrent({
          workspaceId: session.workspaceId,
          sessionId: session.sessionId,
          livekitRoomName: session.livekitRoomName,
          rollbackAttemptId
        });
      } catch {
        // Preserve the publisher token failure as the API cause.
      }
      throw error;
    }
  }

  private toPublicSession(
    session: WorkspaceScreenShareSession
  ): PublicWorkspaceScreenShareSession {
    if (session.status !== "active" || session.startedAt === null) {
      throw screenShareAlreadyActive();
    }
    return {
      id: session.sessionId,
      sharer: {
        userId: session.sharerUserId,
        displayName: session.sharerDisplayName,
        avatarUrl: session.sharerAvatarUrl
      },
      startedAt: session.startedAt
    };
  }

  private async endStaleSession(
    session: WorkspaceScreenShareSession
  ): Promise<boolean> {
    await this.publishEnded(session);
    const ended = await this.state.endIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName
    });
    if (!ended) return false;
    await this.cleanupRoom(ended);
    return true;
  }

  private publishEnded(session: WorkspaceScreenShareSession): Promise<void> {
    return this.realtime.publish({
      version: 1,
      event: "workspace-screen-share:ended",
      workspaceId: session.workspaceId,
      sessionId: session.sessionId
    });
  }

  private async cleanupRoom(
    session: WorkspaceScreenShareSession
  ): Promise<void> {
    try {
      await this.rooms.removeParticipant(session);
    } catch {
      // Redis already owns the authoritative ended state.
    }
    try {
      await this.rooms.deleteRoom(session);
    } catch {
      // Room cleanup is best effort after the state transition.
    }
  }
}
