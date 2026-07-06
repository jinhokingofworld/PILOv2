import { Injectable } from "@nestjs/common";
import { AccessToken, TrackSource, VideoGrant } from "livekit-server-sdk";

export interface LiveKitJoinPayload {
  livekitRoomName: string;
  livekitIdentity: string;
  livekitToken: string;
  livekitUrl: string;
  expiresAt: string;
}

export interface CreateLiveKitJoinTokenInput {
  livekitRoomName: string;
  livekitIdentity: string;
  participantName: string | null;
}

const LIVEKIT_JOIN_TOKEN_TTL_SECONDS = 60 * 60;

@Injectable()
export class LiveKitTokenService {
  async createJoinToken(
    input: CreateLiveKitJoinTokenInput
  ): Promise<LiveKitJoinPayload> {
    const config = this.getConfig();
    const expiresAt = new Date(
      Date.now() + LIVEKIT_JOIN_TOKEN_TTL_SECONDS * 1000
    ).toISOString();

    try {
      const accessToken = new AccessToken(config.apiKey, config.apiSecret, {
        identity: this.requireNonEmpty(input.livekitIdentity),
        name: input.participantName ?? undefined,
        ttl: LIVEKIT_JOIN_TOKEN_TTL_SECONDS
      });
      const grant: VideoGrant = {
        room: this.requireNonEmpty(input.livekitRoomName),
        roomJoin: true,
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canPublishData: false,
        canSubscribe: true
      };

      accessToken.addGrant(grant);

      return {
        livekitRoomName: input.livekitRoomName,
        livekitIdentity: input.livekitIdentity,
        livekitToken: await accessToken.toJwt(),
        livekitUrl: config.livekitUrl,
        expiresAt
      };
    } catch {
      throw new Error("LiveKit token could not be issued");
    }
  }

  private getConfig(): {
    apiKey: string;
    apiSecret: string;
    livekitUrl: string;
  } {
    return {
      apiKey: this.requireConfig(process.env.LIVEKIT_API_KEY),
      apiSecret: this.requireConfig(process.env.LIVEKIT_API_SECRET),
      livekitUrl: this.requireConfig(process.env.LIVEKIT_URL)
    };
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("LiveKit is not configured");
    }

    return value.trim();
  }

  private requireNonEmpty(value: string): string {
    if (!value.trim()) {
      throw new Error("LiveKit token input is invalid");
    }

    return value.trim();
  }
}
