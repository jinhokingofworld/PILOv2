import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service";
import {
  GithubProjectV2WebhookReconcileService,
  type GithubWebhookDeliveryRecoveryFailure
} from "./github-project-v2-webhook-reconcile.service";
import { isGithubSourceWebhookEventName } from "./github-source-webhook-context";
import { GithubSourceWebhookReconcileService } from "./github-source-webhook-reconcile.service";

interface GithubWebhookDeliveryEventRow extends QueryResultRow {
  event_name: string;
}

@Injectable()
export class GithubWebhookDeliveryDispatcherService {
  constructor(
    private readonly database: DatabaseService,
    private readonly projectV2ReconcileService: GithubProjectV2WebhookReconcileService,
    private readonly sourceReconcileService: GithubSourceWebhookReconcileService
  ) {}

  async processDelivery(deliveryId: string): Promise<"terminal" | "retry"> {
    const delivery = await this.database.queryOne<GithubWebhookDeliveryEventRow>(
      `SELECT event_name FROM github_webhook_deliveries WHERE delivery_id=$1`,
      [deliveryId]
    );
    if (!delivery) {
      return "terminal";
    }

    if (isGithubSourceWebhookEventName(delivery.event_name)) {
      return this.sourceReconcileService.processDelivery(deliveryId);
    }

    return this.projectV2ReconcileService.processDelivery(deliveryId);
  }

  recoverDeliveries(
    enqueueDelivery: (deliveryId: string) => Promise<void>
  ): Promise<GithubWebhookDeliveryRecoveryFailure[]> {
    return this.projectV2ReconcileService.recoverDeliveries(enqueueDelivery);
  }
}
