import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubWebhookRequest } from "./dto";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubSyncJobService } from "./github-sync-job.service";
import type {
  GithubWebhookDeliveryPayload,
  GithubWebhookDeliveryStatus
} from "./types";

interface GithubWebhookDeliveryRow extends QueryResultRow {
  delivery_id: string;
  event_name: string;
  status: "received" | "processed" | "failed" | "ignored";
  received_at: Date | string;
  processed_at: Date | string | null;
  error_message: string | null;
}

const SUPPORTED_GITHUB_WEBHOOK_EVENTS = new Set([
  "ping",
  "installation",
  "installation_repositories",
  "repository",
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "projects_v2",
  "projects_v2_item",
  "projects_v2_status_update",
  "github_app_authorization"
]);
const GITHUB_WEBHOOK_RECEIVED_MESSAGE = "GitHub webhook received";
const UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE =
  "Unsupported GitHub webhook event ignored";
const INVALID_GITHUB_WEBHOOK_SIGNATURE_MESSAGE =
  "Invalid GitHub webhook signature";

@Injectable()
export class GithubWebhookService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly syncJobService?: GithubSyncJobService
  ) {}

  async receiveGithubWebhook(
    input: GithubWebhookRequest
  ): Promise<GithubWebhookDeliveryPayload> {
    const deliveryId = this.validateRequiredString(
      input.deliveryId,
      "GitHub webhook delivery id is required"
    );
    const eventName = this.validateRequiredString(
      input.eventName,
      "GitHub webhook event name is required"
    );
    const signature256 = this.validateRequiredString(
      input.signature256,
      "GitHub webhook signature is required"
    );
    const rawBody = this.validateGithubWebhookRawBody(input.rawBody);
    const config = this.configService.getGithubWebhookConfig();

    if (
      !this.isValidGithubWebhookSignature(
        rawBody,
        signature256,
        config.webhookSecret
      )
    ) {
      await this.recordGithubWebhookDelivery({
        deliveryId,
        eventName,
        status: "failed",
        errorMessage: INVALID_GITHUB_WEBHOOK_SIGNATURE_MESSAGE
      });
      throw badRequest(INVALID_GITHUB_WEBHOOK_SIGNATURE_MESSAGE);
    }

    const existing = await this.findGithubWebhookDelivery(deliveryId);
    if (existing) {
      if (this.syncJobService && this.isRecoverableWebhookEnqueueFailure(existing)) {
        await this.enqueueWebhookDeliveryAndMarkReceived(deliveryId);
        const recovered = await this.findGithubWebhookDelivery(deliveryId);
        if (!recovered) throw badRequest("GitHub webhook delivery could not be recorded");
        return this.mapGithubWebhookDelivery(recovered);
      }
      return this.mapGithubWebhookDelivery(existing);
    }

    this.assertGithubWebhookPayload(rawBody, input.body);

    const status: GithubWebhookDeliveryStatus =
      SUPPORTED_GITHUB_WEBHOOK_EVENTS.has(eventName) ? "received" : "ignored";
    const row = await this.recordGithubWebhookDelivery({
      deliveryId,
      eventName,
      status,
      errorMessage:
        status === "ignored" ? UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE : null
    });

    if (status === "received") await this.enqueueWebhookDeliveryAndMarkReceived(deliveryId);

    return this.mapGithubWebhookDelivery(row);
  }

  private async enqueueWebhookDeliveryAndMarkReceived(deliveryId: string): Promise<void> {
    if (!this.syncJobService) return;
    try {
      await this.syncJobService.enqueueWebhookDelivery(deliveryId);
      await this.database.execute(
        `UPDATE github_webhook_deliveries
         SET status='received', processed_at=NULL, error_message=NULL
         WHERE delivery_id=$1`,
        [deliveryId]
      );
    } catch (error) {
      await this.database.execute(
        `UPDATE github_webhook_deliveries SET status='failed', processed_at=now(), error_message=$2 WHERE delivery_id=$1`,
        [deliveryId, "GitHub webhook could not be enqueued"]
      );
      throw error;
    }
  }

  private isRecoverableWebhookEnqueueFailure(row: GithubWebhookDeliveryRow): boolean {
    return row.status === "failed" && row.error_message === "GitHub webhook could not be enqueued";
  }

  private mapGithubWebhookDelivery(
    row: GithubWebhookDeliveryRow
  ): GithubWebhookDeliveryPayload {
    if (row.status !== "received" && row.status !== "ignored") {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    const receivedAt = this.toNullableIsoString(row.received_at);
    if (!receivedAt) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return {
      deliveryId: row.delivery_id,
      eventName: row.event_name,
      status: row.status,
      receivedAt,
      processedAt: this.toNullableIsoString(row.processed_at),
      message: this.getGithubWebhookDeliveryMessage(row)
    };
  }

  private getGithubWebhookDeliveryMessage(row: GithubWebhookDeliveryRow): string {
    if (row.status === "ignored") {
      return row.error_message ?? UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE;
    }

    return GITHUB_WEBHOOK_RECEIVED_MESSAGE;
  }

  private async findGithubWebhookDelivery(
    deliveryId: string
  ): Promise<GithubWebhookDeliveryRow | null> {
    return this.database.queryOne<GithubWebhookDeliveryRow>(
      `
        SELECT
          delivery_id,
          event_name,
          status,
          received_at,
          processed_at,
          error_message
        FROM github_webhook_deliveries
        WHERE delivery_id = $1
      `,
      [deliveryId]
    );
  }

  private async recordGithubWebhookDelivery(input: {
    deliveryId: string;
    eventName: string;
    status: GithubWebhookDeliveryStatus | "failed";
    errorMessage: string | null;
  }): Promise<GithubWebhookDeliveryRow> {
    const row = await this.database.queryOne<GithubWebhookDeliveryRow>(
      `
        INSERT INTO github_webhook_deliveries (
          delivery_id,
          event_name,
          status,
          processed_at,
          error_message
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE WHEN $3 = 'received' THEN NULL ELSE now() END,
          $4
        )
        ON CONFLICT (delivery_id)
        DO NOTHING
        RETURNING
          delivery_id,
          event_name,
          status,
          received_at,
          processed_at,
          error_message
      `,
      [input.deliveryId, input.eventName, input.status, input.errorMessage]
    );

    if (row) {
      return row;
    }

    const existing = await this.findGithubWebhookDelivery(input.deliveryId);
    if (!existing) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return existing;
  }

  private validateGithubWebhookRawBody(value: unknown): Buffer {
    if (!Buffer.isBuffer(value) || value.length === 0) {
      throw badRequest("GitHub webhook raw body is required");
    }

    return value;
  }

  private assertGithubWebhookPayload(rawBody: Buffer, parsedBody: unknown): void {
    if (parsedBody !== undefined) {
      return;
    }

    try {
      JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      throw badRequest("GitHub webhook payload must be JSON");
    }
  }

  private isValidGithubWebhookSignature(
    rawBody: Buffer,
    signature256: string,
    secret: string
  ): boolean {
    if (!signature256.startsWith("sha256=")) {
      return false;
    }

    const expected = `sha256=${createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;
    const actualBuffer = Buffer.from(signature256, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private validateRequiredString(value: unknown, message: string): string {
    if (Array.isArray(value)) {
      throw badRequest(message);
    }

    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
