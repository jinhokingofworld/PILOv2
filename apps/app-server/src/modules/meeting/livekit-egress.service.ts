import { Injectable } from "@nestjs/common";
import {
  EgressClient,
  EgressInfo,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload
} from "livekit-server-sdk";

export interface StartLiveKitEgressInput {
  livekitRoomName: string;
  audioFileKey: string;
}

export interface StartLiveKitEgressResult {
  livekitEgressId: string;
}

export interface StopLiveKitEgressResult {
  status: "COMPLETED" | "FAILED";
  audioFileKey: string | null;
  durationSec: number | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}

interface LiveKitEgressConfig {
  livekitApiUrl: string;
  apiKey: string;
  apiSecret: string;
  recordingsBucket: string;
  awsRegion: string;
}

type LiveKitEgressClient = Pick<
  EgressClient,
  "startRoomCompositeEgress" | "stopEgress"
>;

@Injectable()
export class LiveKitEgressService {
  async startRoomAudioOnlyEgress(
    input: StartLiveKitEgressInput
  ): Promise<StartLiveKitEgressResult> {
    const config = this.getConfig();
    const client = this.createEgressClient(config);

    try {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP3,
        filepath: this.requireNonEmpty(input.audioFileKey),
        disableManifest: true,
        output: {
          case: "s3",
          value: new S3Upload({
            bucket: config.recordingsBucket,
            region: config.awsRegion
          })
        }
      });
      const egress = await client.startRoomCompositeEgress(
        this.requireNonEmpty(input.livekitRoomName),
        output,
        {
          audioOnly: true
        }
      );

      if (!egress.egressId) {
        throw new Error("LiveKit Egress did not return an egress id");
      }

      return {
        livekitEgressId: egress.egressId
      };
    } catch {
      throw new Error("LiveKit Egress could not be started");
    }
  }

  async stopEgress(livekitEgressId: string): Promise<StopLiveKitEgressResult> {
    const config = this.getConfig();
    const client = this.createEgressClient(config);

    try {
      return this.mapStoppedEgress(
        await client.stopEgress(this.requireNonEmpty(livekitEgressId))
      );
    } catch {
      throw new Error("LiveKit Egress could not be stopped");
    }
  }

  protected createEgressClient(config: LiveKitEgressConfig): LiveKitEgressClient {
    return new EgressClient(config.livekitApiUrl, config.apiKey, config.apiSecret);
  }

  private mapStoppedEgress(egress: EgressInfo): StopLiveKitEgressResult {
    if (egress.status === EgressStatus.EGRESS_FAILED) {
      return this.failedResult();
    }

    if (egress.status === EgressStatus.EGRESS_ABORTED) {
      return this.failedResult();
    }

    if (egress.status === EgressStatus.EGRESS_LIMIT_REACHED) {
      return this.failedResult();
    }

    const file = egress.fileResults[0] ?? null;

    return {
      status: "COMPLETED",
      audioFileKey: this.blankToNull(file?.filename ?? null),
      durationSec:
        file === null ? null : this.durationToSeconds(file.duration),
      fileSizeBytes: file === null ? null : this.bigintToNumber(file.size),
      errorMessage: null
    };
  }

  private failedResult(): StopLiveKitEgressResult {
    return {
      status: "FAILED",
      audioFileKey: null,
      durationSec: null,
      fileSizeBytes: null,
      errorMessage: "LiveKit Egress failed"
    };
  }

  private getConfig(): LiveKitEgressConfig {
    this.assertRecordingMode();

    return {
      livekitApiUrl: this.toHttpLiveKitUrl(
        this.requireConfig(process.env.LIVEKIT_WS_URL ?? process.env.LIVEKIT_URL)
      ),
      apiKey: this.requireConfig(process.env.LIVEKIT_API_KEY),
      apiSecret: this.requireConfig(process.env.LIVEKIT_API_SECRET),
      recordingsBucket: this.requireConfig(process.env.LIVEKIT_RECORDINGS_BUCKET),
      awsRegion: this.requireConfig(process.env.AWS_REGION)
    };
  }

  private assertRecordingMode(): void {
    const mode = process.env.LIVEKIT_RECORDING_MODE?.trim();
    if (mode !== undefined && mode !== "" && mode !== "room_audio_only") {
      throw new Error("LiveKit Egress is not configured");
    }
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
      throw new Error("LiveKit Egress is not configured");
    }

    return value.trim();
  }

  private requireNonEmpty(value: string): string {
    if (!value.trim()) {
      throw new Error("LiveKit Egress input is invalid");
    }

    return value.trim();
  }

  private blankToNull(value: string | null): string | null {
    if (value === null || !value.trim()) {
      return null;
    }

    return value.trim();
  }

  private durationToSeconds(duration: bigint): number | null {
    if (duration <= 0n) {
      return null;
    }

    if (duration > 1_000_000_000n) {
      return Math.round(Number(duration) / 1_000_000_000);
    }

    return Number(duration);
  }

  private bigintToNumber(value: bigint): number | null {
    if (value <= 0n) {
      return null;
    }

    return Number(value);
  }
}
