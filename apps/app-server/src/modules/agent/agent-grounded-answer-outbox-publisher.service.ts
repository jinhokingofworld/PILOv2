import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { AgentJobService } from "./agent-job.service";

@Injectable()
export class AgentGroundedAnswerOutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentGroundedAnswerOutboxPublisherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly database: DatabaseService, private readonly jobs: AgentJobService) {}
  onModuleInit(): void { this.timer = setInterval(() => void this.publishDue().catch((error) => this.logger.error("Grounded answer outbox sweep failed", error)), 60_000); void this.publishDue(); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  async publishDue(): Promise<void> {
    const rows = await this.database.query<{ run_id: string }>(`SELECT run_id FROM agent_grounded_answer_outbox WHERE (status = 'pending' AND next_attempt_at <= now()) OR (status = 'publishing' AND claimed_at <= now() - interval '60 seconds') ORDER BY next_attempt_at LIMIT 20`);
    for (const row of rows) await this.publish(row.run_id);
  }
  async publish(runId: string): Promise<void> {
    const token = randomUUID();
    const claim = await this.database.queryOne<{ id: string }>(`UPDATE agent_grounded_answer_outbox SET status = 'publishing', attempt_count = attempt_count + 1, claim_token = $2::uuid, claimed_at = now() WHERE run_id = $1 AND ((status = 'pending' AND next_attempt_at <= now()) OR (status = 'publishing' AND claimed_at <= now() - interval '60 seconds')) RETURNING id`, [runId, token]);
    if (!claim) return;
    try {
      await this.jobs.enqueueAgentGroundedAnswerRequestedJob({ jobType: "agent_grounded_answer_requested", runId });
      await this.database.execute(`UPDATE agent_grounded_answer_outbox SET status = 'delivered', delivered_at = now(), claim_token = NULL, claimed_at = NULL WHERE id = $1 AND claim_token = $2::uuid`, [claim.id, token]);
    } catch {
      await this.database.execute(`UPDATE agent_grounded_answer_outbox SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'pending' END, next_attempt_at = now() + interval '60 seconds', claim_token = NULL, claimed_at = NULL, error_code = 'AGENT_GROUNDED_ANSWER_OUTBOX_PUBLISH_FAILED', error_message = 'Agent grounded answer job could not be published' WHERE id = $1 AND claim_token = $2::uuid`, [claim.id, token]);
    }
  }
}
