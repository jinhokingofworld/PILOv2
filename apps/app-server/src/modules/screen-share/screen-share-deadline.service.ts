import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { ScreenShareCleanupService } from "./screen-share-cleanup.service";
import { ScreenShareRealtimePublisherService } from "./screen-share-realtime-publisher.service";
import { ScreenShareStateService } from "./screen-share-state.service";

const SCREEN_SHARE_DEADLINE_INTERVAL_MS = 1_000;
const SCREEN_SHARE_DEADLINE_LEASE_MS = 30 * 1000;
const SCREEN_SHARE_DEADLINE_BATCH_SIZE = 100;

@Injectable()
export class ScreenShareDeadlineService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScreenShareDeadlineService.name);
  private deadlineInterval: NodeJS.Timeout | null = null;
  private sweepPromise: Promise<number> | null = null;

  constructor(
    private readonly state: ScreenShareStateService,
    private readonly realtime: ScreenShareRealtimePublisherService,
    private readonly cleanup: ScreenShareCleanupService
  ) {}

  onModuleInit(): void {
    if (
      process.env.APP_SERVER_RUNTIME === "github-sync-worker" ||
      !process.env.REDIS_URL?.trim()
    ) {
      return;
    }

    this.triggerDeadlineSweep();
    this.deadlineInterval = setInterval(
      () => this.triggerDeadlineSweep(),
      SCREEN_SHARE_DEADLINE_INTERVAL_MS
    );
    this.deadlineInterval.unref();
  }

  onModuleDestroy(): void {
    if (!this.deadlineInterval) return;
    clearInterval(this.deadlineInterval);
    this.deadlineInterval = null;
  }

  async flushDueDeadlines(
    maxTasks = SCREEN_SHARE_DEADLINE_BATCH_SIZE
  ): Promise<number> {
    if (this.sweepPromise) return this.sweepPromise;
    const sweep = this.flushDueDeadlinesOnce(maxTasks).finally(() => {
      if (this.sweepPromise === sweep) this.sweepPromise = null;
    });
    this.sweepPromise = sweep;
    return sweep;
  }

  protected nowMs(): number {
    return Date.now();
  }

  private async flushDueDeadlinesOnce(maxTasks: number): Promise<number> {
    let processed = 0;
    while (processed < maxTasks) {
      const nowMs = this.nowMs();
      const session = await this.state.claimDueDeadline(
        nowMs,
        nowMs + SCREEN_SHARE_DEADLINE_LEASE_MS
      );
      if (!session) return processed;

      const transition = await this.state.terminateIfCurrent({
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        livekitRoomName: session.livekitRoomName
      });
      processed += 1;
      if (!transition) continue;

      await this.flushTerminationSideEffects();
    }
    return processed;
  }

  private async flushTerminationSideEffects(): Promise<void> {
    try {
      await this.realtime.flushPendingEvents();
    } catch {
      this.logger.error("Screen share deadline realtime flush failed");
    }
    try {
      await this.cleanup.flushPendingCleanups();
    } catch {
      this.logger.error("Screen share deadline cleanup flush failed");
    }
  }

  private triggerDeadlineSweep(): void {
    void this.flushDueDeadlines().catch(() => {
      this.logger.error("Screen share deadline sweep failed");
    });
  }
}
