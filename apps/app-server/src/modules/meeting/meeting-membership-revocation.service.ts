import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RoomServiceClient } from "livekit-server-sdk";
import { createClient, type RedisClientType } from "redis";
import { DatabaseService } from "../../database/database.service";
import {
  isWorkspaceMembershipRevokedEvent,
  WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL
} from "../workspace-membership-revocation/workspace-membership-revocation.types";

export { WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL } from "../workspace-membership-revocation/workspace-membership-revocation.types";

type LiveKitRoomServiceConfig = {
  apiKey: string;
  apiSecret: string;
  livekitApiUrl: string;
};

type LiveKitRoomService = Pick<RoomServiceClient, "removeParticipant">;

type ActiveLiveKitParticipant = {
  livekit_identity: string;
  livekit_room_name: string;
};

@Injectable()
export class MeetingMembershipRevocationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MeetingMembershipRevocationService.name);
  private redisClient: RedisClientType | null = null;

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;

    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return;

    const client = this.createRedisClient(redisUrl);
    client.on("error", () => {
      this.logger.error("Meeting membership revocation Redis connection error");
    });

    try {
      await client.connect();
      await client.subscribe(
        WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
        message => {
          void this.handleRedisMessage(message);
        }
      );
      this.redisClient = client;
    } catch {
      client.destroy();
      this.logger.error("Meeting membership revocation Redis subscription failed");
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.redisClient;
    this.redisClient = null;
    if (!client) return;

    try {
      await client.quit();
    } catch {
      client.destroy();
    }
  }

  async handleMembershipRevocation(event: unknown): Promise<boolean> {
    if (!isWorkspaceMembershipRevokedEvent(event)) return false;

    try {
      const participants = await this.database.query<ActiveLiveKitParticipant>(
        `
          SELECT
            meetings.livekit_room_name,
            meeting_participants.livekit_identity
          FROM meetings
          JOIN meeting_participants
            ON meeting_participants.meeting_id = meetings.id
          WHERE meetings.workspace_id = $1::uuid
            AND meeting_participants.user_id = $2::uuid
            AND meetings.ended_at IS NULL
            AND meeting_participants.left_at IS NULL
        `,
        [event.workspaceId, event.userId]
      );

      if (participants.length === 0) return true;

      const client = this.createRoomServiceClient(this.getRoomServiceConfig());
      const revokeTokenTs = BigInt(Math.floor(this.now().getTime() / 1000) + 1);

      for (const participant of participants) {
        try {
          await client.removeParticipant(
            participant.livekit_room_name,
            participant.livekit_identity,
            { revokeTokenTs }
          );
        } catch (error) {
          if (this.isLiveKitParticipantAbsent(error)) continue;
          throw error;
        }
      }

      return true;
    } catch {
      this.logger.error("Meeting membership revocation LiveKit eviction failed");
      return false;
    }
  }

  protected createRoomServiceClient(
    config: LiveKitRoomServiceConfig
  ): LiveKitRoomService {
    return new RoomServiceClient(
      config.livekitApiUrl,
      config.apiKey,
      config.apiSecret
    );
  }

  protected now(): Date {
    return new Date();
  }

  protected createRedisClient(redisUrl: string): RedisClientType {
    return createClient({ url: redisUrl }) as RedisClientType;
  }

  private async handleRedisMessage(message: string): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(message);
    } catch {
      this.logger.warn("Meeting membership revocation payload is invalid");
      return;
    }

    if (!(await this.handleMembershipRevocation(event))) {
      this.logger.error("Meeting membership revocation could not be handled");
    }
  }

  private getRoomServiceConfig(): LiveKitRoomServiceConfig {
    return {
      livekitApiUrl: this.toHttpLiveKitUrl(
        this.requireConfig(process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL)
      ),
      apiKey: this.requireConfig(process.env.LIVEKIT_API_KEY),
      apiSecret: this.requireConfig(process.env.LIVEKIT_API_SECRET)
    };
  }

  private toHttpLiveKitUrl(url: string): string {
    if (url.startsWith("wss://")) {
      return `https://${url.slice("wss://".length)}`;
    }
    if (url.startsWith("ws://")) {
      return `http://${url.slice("ws://".length)}`;
    }
    return url;
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("LiveKit membership revocation is not configured");
    }
    return value.trim();
  }

  private isLiveKitParticipantAbsent(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String(error.code).toLowerCase() === "not_found"
    );
  }
}
