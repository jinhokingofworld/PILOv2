import { Injectable } from "@nestjs/common";
import { TrackSource, type WebhookEvent } from "livekit-server-sdk";
import type { LiveKitWebhookDeliveryPayload } from "../meeting/livekit-webhook.service";
import { ScreenShareRealtimePublisherService } from "./screen-share-realtime-publisher.service";
import { ScreenShareStateService } from "./screen-share-state.service";
import type { WorkspaceScreenShareSession } from "./screen-share.types";

const PARTICIPANT_DEPARTURE_EVENTS = new Set([
  "participant_left",
  "participant_connection_aborted"
]);

@Injectable()
export class ScreenShareWebhookService {
  constructor(
    private readonly state: ScreenShareStateService,
    private readonly publisher: ScreenShareRealtimePublisherService
  ) {}

  async canHandle(event: WebhookEvent): Promise<boolean> {
    const roomName = this.roomName(event);
    if (!roomName) return false;
    return this.state.isKnownScreenShareRoom(roomName);
  }

  async handleVerifiedEvent(
    event: WebhookEvent
  ): Promise<LiveKitWebhookDeliveryPayload> {
    const roomName = this.roomName(event);
    if (!roomName) return this.delivery(event, "ignored");

    const session = await this.state.getByRoom(roomName);
    if (!session) {
      await this.flushRealtimeOutbox();
      return this.delivery(event, "ignored");
    }

    if (
      event.event === "track_published" &&
      this.isExpectedScreenTrack(event, session)
    ) {
      const transition = await this.state.activate({
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        livekitRoomName: session.livekitRoomName,
        startedAt: this.eventIso(event)
      });
      if (transition) await this.flushRealtimeOutbox();
      return this.delivery(event, "received");
    }

    if (this.isExpectedEndEvent(event, session)) {
      const transition = await this.state.terminateIfCurrent({
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        livekitRoomName: session.livekitRoomName
      });
      if (transition) await this.flushRealtimeOutbox();
      return this.delivery(event, "received");
    }

    return this.delivery(event, "ignored");
  }

  protected now(): Date {
    return new Date();
  }

  private async flushRealtimeOutbox(): Promise<void> {
    try {
      await this.publisher.flushPendingEvents();
    } catch {
      // The Redis Stream retains the event for the background dispatcher.
    }
  }

  private isExpectedScreenTrack(
    event: WebhookEvent,
    session: WorkspaceScreenShareSession
  ): boolean {
    return (
      event.participant?.identity === session.sharerLiveKitIdentity &&
      event.track?.source === TrackSource.SCREEN_SHARE
    );
  }

  private isExpectedEndEvent(
    event: WebhookEvent,
    session: WorkspaceScreenShareSession
  ): boolean {
    if (event.event === "room_finished") return true;
    if (event.participant?.identity !== session.sharerLiveKitIdentity) {
      return false;
    }
    if (PARTICIPANT_DEPARTURE_EVENTS.has(event.event)) return true;
    return (
      event.event === "track_unpublished" &&
      event.track?.source === TrackSource.SCREEN_SHARE
    );
  }

  private roomName(event: WebhookEvent): string | null {
    const value = event.room?.name;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private eventIso(event: WebhookEvent): string {
    const seconds = Number(event.createdAt);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      return this.now().toISOString();
    }
    return new Date(seconds * 1000).toISOString();
  }

  private delivery(
    event: WebhookEvent,
    status: "received" | "ignored"
  ): LiveKitWebhookDeliveryPayload {
    return {
      deliveryId: event.id,
      eventName: event.event,
      status,
      receivedAt: this.now().toISOString(),
      message:
        status === "received"
          ? "LiveKit webhook received"
          : "Unsupported LiveKit webhook event ignored"
    };
  }
}
