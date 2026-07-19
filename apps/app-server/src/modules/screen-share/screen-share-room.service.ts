import { Injectable } from "@nestjs/common";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { serviceUnavailable } from "./screen-share.errors";
import type { WorkspaceScreenShareSession } from "./screen-share.types";

type ScreenShareRoomConfig = {
  livekitApiUrl: string;
  apiKey: string;
  apiSecret: string;
};

type LiveKitRoomClient = Pick<
  RoomServiceClient,
  "listParticipants" | "removeParticipant" | "deleteRoom"
>;

@Injectable()
export class ScreenShareRoomService {
  private client: LiveKitRoomClient | null = null;

  async hasActiveScreenTrack(
    session: WorkspaceScreenShareSession
  ): Promise<boolean> {
    return this.runRoomCommand(async client => {
      const participants = await client.listParticipants(
        session.livekitRoomName
      );
      const publisher = participants.find(
        item => item.identity === session.sharerLiveKitIdentity
      );
      return (
        publisher?.tracks.some(
          track => track.source === TrackSource.SCREEN_SHARE && !track.muted
        ) ?? false
      );
    });
  }

  async removeParticipant(
    session: WorkspaceScreenShareSession
  ): Promise<void> {
    await this.runRoomCommand(async client => {
      try {
        await client.removeParticipant(
          session.livekitRoomName,
          session.sharerLiveKitIdentity
        );
      } catch (error) {
        if (!this.isParticipantAbsent(error)) throw error;
      }
    });
  }

  async removeParticipantForRevocation(
    session: WorkspaceScreenShareSession
  ): Promise<void> {
    await this.revokeParticipantIdentity(
      session.livekitRoomName,
      session.sharerLiveKitIdentity
    );
  }

  async revokeParticipantIdentity(
    livekitRoomName: string,
    identity: string
  ): Promise<void> {
    await this.runRoomCommand(async client => {
      try {
        await client.removeParticipant(
          livekitRoomName,
          identity,
          { revokeTokenTs: this.revocationTimestamp() }
        );
      } catch (error) {
        if (!this.isParticipantAbsent(error)) throw error;
      }
    });
  }

  async removeViewerParticipants(
    session: WorkspaceScreenShareSession,
    userId: string
  ): Promise<void> {
    await this.runRoomCommand(async client => {
      let participants;
      try {
        participants = await client.listParticipants(session.livekitRoomName);
      } catch (error) {
        if (this.isParticipantAbsent(error)) return;
        throw error;
      }

      const prefix = `screen-share-viewer:${session.sessionId}:${userId}:`;
      const revokeTokenTs = this.revocationTimestamp();
      for (const participant of participants) {
        if (!participant.identity.startsWith(prefix)) continue;
        try {
          await client.removeParticipant(
            session.livekitRoomName,
            participant.identity,
            { revokeTokenTs }
          );
        } catch (error) {
          if (!this.isParticipantAbsent(error)) throw error;
        }
      }
    });
  }

  async deleteRoom(session: WorkspaceScreenShareSession): Promise<void> {
    await this.runRoomCommand(async client => {
      try {
        await client.deleteRoom(session.livekitRoomName);
      } catch (error) {
        if (!this.isParticipantAbsent(error)) throw error;
      }
    });
  }

  protected createRoomServiceClient(
    config: ScreenShareRoomConfig
  ): LiveKitRoomClient {
    return new RoomServiceClient(
      config.livekitApiUrl,
      config.apiKey,
      config.apiSecret
    );
  }

  protected now(): Date {
    return new Date();
  }

  private getClient(): LiveKitRoomClient {
    if (!this.client) {
      this.client = this.createRoomServiceClient(this.getConfig());
    }
    return this.client;
  }

  private async runRoomCommand<T>(
    operation: (client: LiveKitRoomClient) => Promise<T>
  ): Promise<T> {
    try {
      return await operation(this.getClient());
    } catch {
      throw serviceUnavailable("Screen sharing is unavailable");
    }
  }

  private getConfig(): ScreenShareRoomConfig {
    return {
      livekitApiUrl: this.toHttpUrl(
        this.requireConfig(process.env.LIVEKIT_URL)
      ),
      apiKey: this.requireConfig(process.env.LIVEKIT_API_KEY),
      apiSecret: this.requireConfig(process.env.LIVEKIT_API_SECRET)
    };
  }

  private toHttpUrl(url: string): string {
    if (url.startsWith("wss://")) return `https://${url.slice(6)}`;
    if (url.startsWith("ws://")) return `http://${url.slice(5)}`;
    return url;
  }

  private requireConfig(value: string | undefined): string {
    if (!value?.trim()) {
      throw serviceUnavailable("Screen sharing is unavailable");
    }
    return value.trim();
  }

  private revocationTimestamp(): bigint {
    return BigInt(Math.floor(this.now().getTime() / 1000) + 1);
  }

  private isParticipantAbsent(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      String(error.code).toLowerCase() === "not_found"
    );
  }
}
