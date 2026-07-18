import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  MeetingService,
  type MeetingAgentActionItemSearchPayload,
  type MeetingAgentMeetingSearchPayload,
  type MeetingReportSummaryPayload
} from "../../meeting/meeting.service";
import { WorkspaceService } from "../../workspace/workspace.service";
import type { AgentToolContext } from "../types/agent-tool.types";

const MAX_CANDIDATES = 3;
const RESOLUTION_QUERY_LIMIT = MAX_CANDIDATES + 1;
const SELECTION_TOKEN_VERSION = "v1";
const SELECTION_TOKEN_TTL_MS = 15 * 60 * 1000;

export type MeetingAgentResourceType =
  | "meeting_room"
  | "meeting"
  | "meeting_report"
  | "workspace_member"
  | "meeting_report_action_item";

export interface MeetingAgentResourceReference {
  resourceType: MeetingAgentResourceType;
  resourceId: string;
  reportId?: string;
}

export interface MeetingAgentResourceCandidate {
  resourceType: MeetingAgentResourceType;
  label: string;
  description: string | null;
  status: string | null;
  selectionToken?: string;
}

export type MeetingAgentResourceResolution =
  | {
      kind: "selected";
      reference: MeetingAgentResourceReference;
      candidate: MeetingAgentResourceCandidate;
      selectionToken: string;
    }
  | {
      kind: "needs_clarification";
      reason: "not_found" | "ambiguous";
      candidates: MeetingAgentResourceCandidate[];
      totalCandidates: number;
    };

export interface MeetingAgentMeetingSelector {
  roomName?: string;
  from?: string;
  to?: string;
}

export interface MeetingAgentReportSelector {
  from?: string;
  to?: string;
  status?: "PROCESSING" | "QUEUED" | "TRANSCRIBING" | "SUMMARIZING" | "COMPLETED" | "FAILED";
  /** Agent-only room-name filter; it is not part of the public Meeting API. */
  roomName?: string;
}

export interface MeetingAgentMemberSelector {
  self?: boolean;
  displayName?: string;
}

export interface MeetingAgentActionItemSelector {
  reportId?: string;
  assigneeUserId?: string;
  status?: MeetingAgentActionItemSearchPayload["status"];
  title?: string;
  ordinal?: number;
}

interface SelectionTokenPayload {
  version: typeof SELECTION_TOKEN_VERSION;
  userId: string;
  workspaceId: string;
  runId: string;
  resourceType: MeetingAgentResourceType;
  resourceId: string;
  reportId?: string;
  expiresAt: number;
}

@Injectable()
export class MeetingAgentResourceResolver {
  constructor(
    private readonly meetingService: MeetingService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async resolveMeetingRoom(
    context: AgentToolContext,
    roomName: string
  ): Promise<MeetingAgentResourceResolution> {
    const normalized = this.normalize(roomName);
    if (!normalized) {
      return this.notFound();
    }
    const rooms = await this.meetingService.listMeetingRooms(
      context.currentUserId,
      context.workspaceId
    );
    const matches = rooms.rooms.filter(
      (room) => this.normalize(room.name) === normalized
    );
    return this.resolveCandidates(context, matches, (room) => ({
      reference: { resourceType: "meeting_room", resourceId: room.id },
      candidate: {
        resourceType: "meeting_room",
        label: room.name,
        description: room.isDefault ? "기본 회의방" : null,
        status: null
      }
    }));
  }

  async resolveCurrentMeeting(
    context: AgentToolContext
  ): Promise<MeetingAgentResourceResolution> {
    await this.workspaceService.assertWorkspaceAccess(
      context.currentUserId,
      context.workspaceId
    );
    const active = await this.meetingService.getCurrentUserActiveMeeting(
      context.currentUserId
    );
    if (
      active.meeting === null ||
      active.meetingRoom === null ||
      active.meeting.workspaceId !== context.workspaceId
    ) {
      return this.notFound();
    }
    return this.selected(context, {
      resourceType: "meeting",
      resourceId: active.meeting.id
    }, {
      resourceType: "meeting",
      label: active.meetingRoom.name,
      description: active.meeting.startedAt,
      status: active.meeting.endedAt === null ? "active" : "ended"
    });
  }

  async resolveMeeting(
    context: AgentToolContext,
    selector: MeetingAgentMeetingSelector
  ): Promise<MeetingAgentResourceResolution> {
    const matches = await this.meetingService.listMeetingsForAgent(
      context.currentUserId,
      context.workspaceId,
      { ...selector, limit: RESOLUTION_QUERY_LIMIT }
    );
    return this.resolveCandidates(context, matches.meetings, (item) =>
      this.meetingCandidate(item)
    );
  }

  async resolveReport(
    context: AgentToolContext,
    selector: MeetingAgentReportSelector
  ): Promise<MeetingAgentResourceResolution> {
    const reports = await this.meetingService.listReportsForAgent(
      context.currentUserId,
      context.workspaceId,
      { ...selector, limit: RESOLUTION_QUERY_LIMIT }
    );
    return this.resolveCandidates(context, reports.reports, (report) => ({
      reference: { resourceType: "meeting_report", resourceId: report.id },
      candidate: this.reportCandidate(report)
    }));
  }

  async resolveLatestReport(
    context: AgentToolContext
  ): Promise<MeetingAgentResourceResolution> {
    const reports = await this.meetingService.listReportsForAgent(
      context.currentUserId,
      context.workspaceId,
      { limit: 1 }
    );
    return this.resolveCandidates(context, reports.reports, (report) => ({
      reference: { resourceType: "meeting_report", resourceId: report.id },
      candidate: this.reportCandidate(report)
    }));
  }

  async resolveMember(
    context: AgentToolContext,
    selector: MeetingAgentMemberSelector
  ): Promise<MeetingAgentResourceResolution> {
    const members = await this.workspaceService.listMembers(
      context.currentUserId,
      context.workspaceId
    );
    const matches = selector.self
      ? members.filter((member) => member.userId === context.currentUserId)
      : typeof selector.displayName === "string"
        ? members.filter(
            (member) => this.normalize(member.user.name ?? "") === this.normalize(selector.displayName ?? "")
          )
        : [];
    return this.resolveCandidates(context, matches, (member) => ({
      reference: { resourceType: "workspace_member", resourceId: member.userId },
      candidate: {
        resourceType: "workspace_member",
        label: member.user.name ?? "PILO 사용자",
        description: this.memberDescription(member.role, member.user.email),
        status: null
      }
    }));
  }

  async resolveActionItem(
    context: AgentToolContext,
    selector: MeetingAgentActionItemSelector
  ): Promise<MeetingAgentResourceResolution> {
    if (
      selector.ordinal !== undefined &&
      (!Number.isInteger(selector.ordinal) || selector.ordinal < 1)
    ) {
      return this.notFound();
    }
    const result = await this.meetingService.listActionItemsForAgent(
      context.currentUserId,
      context.workspaceId,
      {
        reportId: selector.reportId,
        assigneeUserId: selector.assigneeUserId,
        status: selector.status,
        title: selector.title,
        limit:
          selector.ordinal === undefined
            ? RESOLUTION_QUERY_LIMIT
            : Math.min(Math.max(selector.ordinal, 1), 20)
      }
    );
    const matches = selector.ordinal !== undefined
      ? result.actionItems.slice(selector.ordinal - 1, selector.ordinal)
      : result.actionItems;
    return this.resolveCandidates(context, matches, (item) => ({
      reference: {
        resourceType: "meeting_report_action_item",
        resourceId: item.id,
        reportId: item.reportId
      },
      candidate: this.actionItemCandidate(item)
    }));
  }

  async revalidateSelectionToken(
    context: AgentToolContext,
    token: string
  ): Promise<MeetingAgentResourceReference | null> {
    const payload = this.readSelectionToken(context, token);
    if (payload === null) {
      return null;
    }
    return this.revalidateReference(context, this.referenceFromPayload(payload));
  }

  async revalidateReference(
    context: AgentToolContext,
    reference: MeetingAgentResourceReference
  ): Promise<MeetingAgentResourceReference | null> {
    try {
      switch (reference.resourceType) {
        case "meeting_room": {
          const rooms = await this.meetingService.listMeetingRooms(
            context.currentUserId,
            context.workspaceId
          );
          return rooms.rooms.some((room) => room.id === reference.resourceId)
            ? reference
            : null;
        }
        case "meeting": {
          await this.meetingService.getMeeting(
            context.currentUserId,
            context.workspaceId,
            reference.resourceId
          );
          return reference;
        }
        case "meeting_report": {
          await this.meetingService.getReport(
            context.currentUserId,
            context.workspaceId,
            reference.resourceId
          );
          return reference;
        }
        case "workspace_member": {
          const members = await this.workspaceService.listMembers(
            context.currentUserId,
            context.workspaceId
          );
          return members.some((member) => member.userId === reference.resourceId)
            ? reference
            : null;
        }
        case "meeting_report_action_item": {
          if (!reference.reportId) {
            return null;
          }
          const report = await this.meetingService.getReport(
            context.currentUserId,
            context.workspaceId,
            reference.reportId
          );
          return report.report.actionItems.some(
            (item) => item.id === reference.resourceId
          )
            ? reference
            : null;
        }
      }
    } catch {
      return null;
    }
  }

  private async resolveCandidates<T>(
    context: AgentToolContext,
    matches: T[],
    map: (item: T) => {
      reference: MeetingAgentResourceReference;
      candidate: MeetingAgentResourceCandidate;
    }
  ): Promise<MeetingAgentResourceResolution> {
    if (matches.length === 0) {
      return this.notFound();
    }
    if (matches.length === 1) {
      const resolved = map(matches[0]);
      return this.selected(context, resolved.reference, resolved.candidate);
    }
    return {
      kind: "needs_clarification",
      reason: "ambiguous",
      candidates: matches.slice(0, MAX_CANDIDATES).map((item) => {
        const resolved = map(item);
        return {
          ...resolved.candidate,
          selectionToken: this.createSelectionToken(context, resolved.reference)
        };
      }),
      totalCandidates: matches.length
    };
  }

  private selected(
    context: AgentToolContext,
    reference: MeetingAgentResourceReference,
    candidate: MeetingAgentResourceCandidate
  ): MeetingAgentResourceResolution {
    return {
      kind: "selected",
      reference,
      candidate,
      selectionToken: this.createSelectionToken(context, reference)
    };
  }

  private notFound(): MeetingAgentResourceResolution {
    return {
      kind: "needs_clarification",
      reason: "not_found",
      candidates: [],
      totalCandidates: 0
    };
  }

  private meetingCandidate(item: MeetingAgentMeetingSearchPayload): {
    reference: MeetingAgentResourceReference;
    candidate: MeetingAgentResourceCandidate;
  } {
    return {
      reference: { resourceType: "meeting", resourceId: item.meeting.id },
      candidate: {
        resourceType: "meeting",
        label: item.roomName,
        description: item.meeting.startedAt,
        status: item.meeting.endedAt === null ? "active" : "ended"
      }
    };
  }

  private reportCandidate(
    report: MeetingReportSummaryPayload
  ): MeetingAgentResourceCandidate {
    return {
      resourceType: "meeting_report",
      label: report.summary?.slice(0, 120) || "회의록",
      description: report.createdAt,
      status: report.status
    };
  }

  private actionItemCandidate(
    item: MeetingAgentActionItemSearchPayload
  ): MeetingAgentResourceCandidate {
    return {
      resourceType: "meeting_report_action_item",
      label: item.title,
      description: item.assignee?.name ?? null,
      status: item.status
    };
  }

  private createSelectionToken(
    context: AgentToolContext,
    reference: MeetingAgentResourceReference
  ): string {
    const payload: SelectionTokenPayload = {
      version: SELECTION_TOKEN_VERSION,
      userId: context.currentUserId,
      workspaceId: context.workspaceId,
      runId: context.runId,
      resourceType: reference.resourceType,
      resourceId: reference.resourceId,
      ...(reference.reportId ? { reportId: reference.reportId } : {}),
      expiresAt: Date.now() + SELECTION_TOKEN_TTL_MS
    };
    const key = this.selectionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final()
    ]);
    const body = [
      SELECTION_TOKEN_VERSION,
      iv.toString("base64url"),
      encrypted.toString("base64url"),
      cipher.getAuthTag().toString("base64url")
    ].join(".");
    const signature = createHmac("sha256", key).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  private readSelectionToken(
    context: AgentToolContext,
    token: string
  ): SelectionTokenPayload | null {
    const parts = token.split(".");
    if (parts.length !== 5 || parts[0] !== SELECTION_TOKEN_VERSION) {
      return null;
    }
    const [version, iv, encrypted, authTag, signature] = parts;
    const body = [version, iv, encrypted, authTag].join(".");
    const key = this.selectionKey();
    const expected = createHmac("sha256", key).update(body).digest();
    const provided = Buffer.from(signature, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return null;
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(authTag, "base64url"));
      const raw = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final()
      ]).toString("utf8");
      const payload = JSON.parse(raw) as SelectionTokenPayload;
      if (
        payload.version !== SELECTION_TOKEN_VERSION ||
        payload.userId !== context.currentUserId ||
        payload.workspaceId !== context.workspaceId ||
        payload.runId !== context.runId ||
        !Number.isFinite(payload.expiresAt) ||
        payload.expiresAt < Date.now()
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private selectionKey(): Buffer {
    const secret = process.env.SESSION_SECRET?.trim();
    if (!secret) {
      throw new Error("SESSION_SECRET is required for Meeting Agent selection tokens");
    }
    return createHash("sha256").update(secret, "utf8").digest();
  }

  private referenceFromPayload(
    payload: SelectionTokenPayload
  ): MeetingAgentResourceReference {
    return {
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      ...(payload.reportId ? { reportId: payload.reportId } : {})
    };
  }

  private normalize(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  }

  private memberDescription(role: string, email: string | null): string {
    const maskedEmail = this.maskEmail(email);
    return maskedEmail ? `${role} · ${maskedEmail}` : role;
  }

  private maskEmail(email: string | null): string | null {
    if (!email) return null;
    const [local, domain] = email.trim().split("@");
    if (!local || !domain) return null;
    const prefix = [...local].slice(0, 2).join("");
    return `${prefix}${"*".repeat(Math.max(1, [...local].length - prefix.length))}@${domain}`;
  }
}
