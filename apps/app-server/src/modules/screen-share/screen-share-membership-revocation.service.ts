import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import {
  isWorkspaceMembershipRevokedEvent,
  WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL
} from "../workspace-membership-revocation/workspace-membership-revocation.types";
import { ScreenShareRoomService } from "./screen-share-room.service";
import { ScreenShareService } from "./screen-share.service";
import { ScreenShareStateService } from "./screen-share-state.service";

const VIEWER_REVOCATION_RETRY_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  12_000,
  16_000
] as const;
const VIEWER_REVOCATION_WORKER_INTERVAL_MS = 1_000;
const VIEWER_REVOCATION_LEASE_MS = 60_000;
const VIEWER_REVOCATION_RETRY_MS = 1_000;

@Injectable()
export class ScreenShareMembershipRevocationService
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger = new Logger(
    ScreenShareMembershipRevocationService.name
  );
  private redisClient: RedisClientType | null = null;
  private viewerRevocationInterval: ReturnType<typeof setInterval> | null =
    null;
  private viewerRevocationSweep: Promise<void> | null = null;
  constructor(
    private readonly state: ScreenShareStateService,
    private readonly screenShares: ScreenShareService,
    private readonly rooms: ScreenShareRoomService
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;

    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return;

    this.startViewerRevocationWorker();

    const client = this.createRedisClient(redisUrl);
    client.on("error", () => {
      this.logger.error(
        "Screen share membership revocation Redis connection error"
      );
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
      this.logger.error(
        "Screen share membership revocation Redis subscription failed"
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.viewerRevocationInterval) {
      clearInterval(this.viewerRevocationInterval);
      this.viewerRevocationInterval = null;
    }
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
      const session = await this.state.getCurrent(event.workspaceId);
      if (!session) return true;

      if (session.sharerUserId === event.userId) {
        await this.screenShares.endForRevocation(
          event.workspaceId,
          event.userId
        );
      } else {
        const identityScope = {
          workspaceId: session.workspaceId,
          sessionId: session.sessionId,
          livekitRoomName: session.livekitRoomName,
          userId: event.userId
        };
        if (
          await this.state.enqueueViewerRevocation(
            identityScope,
            this.nowMs()
          )
        ) {
          await this.processViewerRevocationTasks();
        }
      }
      return true;
    } catch {
      this.logger.error("Screen share membership revocation eviction failed");
      return false;
    }
  }

  protected createRedisClient(redisUrl: string): RedisClientType {
    return createClient({ url: redisUrl }) as RedisClientType;
  }

  protected viewerRevocationRetryDelaysMs(): readonly number[] {
    return VIEWER_REVOCATION_RETRY_DELAYS_MS;
  }

  protected nowMs(): number {
    return Date.now();
  }

  protected async waitBeforeViewerRevocationRetry(
    delayMs: number
  ): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  async processViewerRevocationTasks(maxTasks = 100): Promise<number> {
    let processed = 0;
    while (processed < maxTasks) {
      const now = this.nowMs();
      const task = await this.state.claimDueViewerRevocation(
        now,
        now + VIEWER_REVOCATION_LEASE_MS
      );
      if (!task) return processed;
      await this.processViewerRevocationTask(task);
      processed += 1;
    }
    return processed;
  }

  private async processViewerRevocationTask(
    task: {
      workspaceId: string;
      sessionId: string;
      livekitRoomName: string;
      userId: string;
    }
  ): Promise<void> {
    const identities = await this.state.listViewerIdentities(task);
    const revocations = await Promise.allSettled(
      identities.map(identity =>
        this.revokeViewerIdentityWithRetry(
          task.livekitRoomName,
          task,
          identity
        )
      )
    );
    await this.state.completeViewerRevocation(
      task,
      this.nowMs() + VIEWER_REVOCATION_RETRY_MS
    );
    const failed = revocations.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  private startViewerRevocationWorker(): void {
    this.triggerViewerRevocationSweep();
    this.viewerRevocationInterval = setInterval(
      () => this.triggerViewerRevocationSweep(),
      VIEWER_REVOCATION_WORKER_INTERVAL_MS
    );
    this.viewerRevocationInterval.unref?.();
  }

  private triggerViewerRevocationSweep(): void {
    if (this.viewerRevocationSweep) return;
    const sweep = this.processViewerRevocationTasks()
      .then(() => undefined)
      .catch(() => {
        this.logger.error("Screen share viewer revocation retry failed");
      })
      .finally(() => {
        if (this.viewerRevocationSweep === sweep) {
          this.viewerRevocationSweep = null;
        }
      });
    this.viewerRevocationSweep = sweep;
  }

  private async revokeViewerIdentityWithRetry(
    livekitRoomName: string,
    identityScope: {
      workspaceId: string;
      sessionId: string;
      livekitRoomName: string;
      userId: string;
    },
    identity: string
  ): Promise<void> {
    const retryDelays = this.viewerRevocationRetryDelaysMs();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.rooms.revokeParticipantIdentity(
          livekitRoomName,
          identity
        );
        await this.state.removeViewerIdentityIfCurrent({
          ...identityScope,
          identity
        });
        return;
      } catch (error) {
        const retryDelay = retryDelays[attempt];
        if (retryDelay === undefined) throw error;
        await this.waitBeforeViewerRevocationRetry(retryDelay);
      }
    }
  }

  private async handleRedisMessage(message: string): Promise<void> {
    let event: unknown;
    try {
      event = JSON.parse(message);
    } catch {
      this.logger.warn("Screen share membership revocation payload is invalid");
      return;
    }

    if (!(await this.handleMembershipRevocation(event))) {
      this.logger.error(
        "Screen share membership revocation could not be handled"
      );
    }
  }
}
