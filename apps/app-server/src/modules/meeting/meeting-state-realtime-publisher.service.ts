import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

export const MEETING_STATE_REDIS_CHANNEL = "meeting:state-events";

export type MeetingStateChange =
  | "started"
  | "participant_joined"
  | "participant_left"
  | "ended"
  | "recording_started"
  | "recording_ended"
  | "recording_failed";

export type MeetingStateRealtimeEventInput = {
  workspaceId: string;
  meetingId: string;
  change: MeetingStateChange;
};

@Injectable()
export class MeetingStateRealtimePublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(MeetingStateRealtimePublisherService.name);
  private client: RedisClientType | null = null;

  async publishStateUpdated(input: MeetingStateRealtimeEventInput): Promise<void> {
    const client = await this.getClient();
    if (!client) return;

    await client.publish(
      MEETING_STATE_REDIS_CHANNEL,
      JSON.stringify({
        event: "meeting:state:updated",
        workspaceId: input.workspaceId,
        meetingId: input.meetingId,
        change: input.change,
        updatedAt: new Date().toISOString()
      })
    );
  }

  async publishStateUpdatedSafely(
    input: MeetingStateRealtimeEventInput
  ): Promise<void> {
    try {
      await this.publishStateUpdated(input);
    } catch {
      this.logger.warn(
        `Meeting state realtime publish failed meeting_id=${input.meetingId} change=${input.change}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    this.client = null;
  }

  private async getClient(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.client) return this.client;

    const client = createClient({ url });
    client.on("error", error => this.logger.error("Meeting state Redis publish failed", error));
    await client.connect();
    this.client = client as RedisClientType;
    return this.client;
  }
}
