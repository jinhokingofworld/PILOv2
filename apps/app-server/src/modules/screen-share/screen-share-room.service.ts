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
    await this.runRoomCommand(client =>
      client.removeParticipant(
        session.livekitRoomName,
        session.sharerLiveKitIdentity
      )
    );
  }

  async deleteRoom(session: WorkspaceScreenShareSession): Promise<void> {
    await this.runRoomCommand(client =>
      client.deleteRoom(session.livekitRoomName).then(() => undefined)
    );
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
}
