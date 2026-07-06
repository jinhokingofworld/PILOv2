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
  "listEgress" | "startRoomCompositeEgress" | "stopEgress"
>;

const EGRESS_STOP_POLL_ATTEMPTS = 5;
const EGRESS_STOP_POLL_DELAY_MS = 500;

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
    const egressId = this.requireNonEmpty(livekitEgressId);

    try {
      const stopped = this.mapTerminalEgress(await client.stopEgress(egressId));
      if (stopped !== null) {
        return stopped;
      }

      for (let attempt = 0; attempt < EGRESS_STOP_POLL_ATTEMPTS; attempt += 1) {
        await this.delay(EGRESS_STOP_POLL_DELAY_MS);
        const [egress] = await client.listEgress({ egressId });
        const terminal = egress === undefined ? null : this.mapTerminalEgress(egress);
        if (terminal !== null) {
          return terminal;
        }
      }

      return this.failedResult("LiveKit Egress did not reach a terminal state");
    } catch {
      throw new Error("LiveKit Egress could not be stopped");
    }
  }

  protected createEgressClient(config: LiveKitEgressConfig): LiveKitEgressClient {
    return new EgressClient(config.livekitApiUrl, config.apiKey, config.apiSecret);
  }

  private mapTerminalEgress(egress: EgressInfo): StopLiveKitEgressResult | null {
    if (egress.status === EgressStatus.EGRESS_COMPLETE) {
      const file = egress.fileResults[0] ?? null;
      if (file === null) {
        return this.failedResult("LiveKit Egress completed without a file");
      }

      return {
        status: "COMPLETED",
        audioFileKey: this.blankToNull(file.filename),
        durationSec: this.durationToSeconds(file.duration),
        fileSizeBytes: this.bigintToNumber(file.size),
        errorMessage: null
      };
    }

    if (egress.status === EgressStatus.EGRESS_FAILED) {
      return this.failedResult();
    }

    if (egress.status === EgressStatus.EGRESS_ABORTED) {
      return this.failedResult();
    }

    if (egress.status === EgressStatus.EGRESS_LIMIT_REACHED) {
      return this.failedResult();
    }

    return null;
  }

  private failedResult(errorMessage = "LiveKit Egress failed"): StopLiveKitEgressResult {
    return {
      status: "FAILED",
      audioFileKey: null,
      durationSec: null,
      fileSizeBytes: null,
      errorMessage
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

    return Math.max(1, Math.ceil(Number(duration) / 1_000_000_000));
  }

  private bigintToNumber(value: bigint): number | null {
    if (value <= 0n) {
      return null;
    }

    return Number(value);
  }

  protected async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
