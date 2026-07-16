import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { GithubWebhookRequest } from "./dto";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubSyncJobService } from "./github-sync-job.service";
import {
  type GithubSourceWebhookContext,
  isGithubSourceWebhookEventName,
  parseGithubSourceWebhookContext
} from "./github-source-webhook-context";
import {
  GithubProjectV2WebhookContext,
  parseGithubProjectV2WebhookContext
} from "./github-webhook-context";
import type {
  GithubWebhookDeliveryPayload,
  GithubWebhookDeliveryStatus
} from "./types";

interface GithubWebhookDeliveryRow extends QueryResultRow {
  delivery_id: string;
  event_name: string;
  status: "received" | "processing" | "processed" | "failed" | "ignored";
  received_at: Date | string;
  processed_at: Date | string | null;
  error_message: string | null;
  action: string | null;
  github_installation_id: number | null;
  project_v2_node_id: string | null;
  project_item_node_id: string | null;
}

interface RecordedGithubWebhookDelivery {
  row: GithubWebhookDeliveryRow;
  inserted: boolean;
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
const INVALID_PROJECT_V2_ITEM_WEBHOOK_CONTEXT_MESSAGE =
  "GitHub ProjectV2 webhook context is invalid";
const INVALID_SOURCE_WEBHOOK_CONTEXT_MESSAGE =
  "GitHub source webhook context is invalid or irrelevant";
const UNSELECTED_PROJECT_V2_ITEM_WEBHOOK_MESSAGE =
  "GitHub ProjectV2 webhook project is not selected";
const GITHUB_WEBHOOK_ENQUEUE_PENDING_MESSAGE =
  "GitHub webhook enqueue is pending";

@Injectable()
export class GithubWebhookService {
  private publicationAttempt = 0;

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
        const recovered = await this.prepareFailedWebhookDeliveryForEnqueue(deliveryId);
        if (recovered) {
          const response = await this.findGithubWebhookDelivery(deliveryId);
          if (!response) throw badRequest("GitHub webhook delivery could not be recorded");
          const payload = this.mapGithubWebhookDelivery(response);
          const publicationOwner = await this.claimPendingWebhookDeliveryForPublication(
            deliveryId
          );
          if (publicationOwner) {
            await this.enqueueWebhookDelivery(deliveryId, publicationOwner);
          }
          return payload;
        }
      }
      return this.mapGithubWebhookDelivery(existing);
    }

    this.assertGithubWebhookPayload(rawBody, input.body);

    if (eventName === "projects_v2_item") {
      return this.receiveProjectV2ItemWebhook(deliveryId, eventName, input.body);
    }

    if (isGithubSourceWebhookEventName(eventName)) {
      return this.receiveSourceWebhook(deliveryId, eventName, input.body);
    }

    const status: GithubWebhookDeliveryStatus =
      SUPPORTED_GITHUB_WEBHOOK_EVENTS.has(eventName) ? "received" : "ignored";
    const delivery = await this.recordGithubWebhookDelivery({
      deliveryId,
      eventName,
      status,
      errorMessage:
        status === "ignored" ? UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE : null
    });

    if (status === "received" && delivery.inserted) {
      await this.enqueueWebhookDelivery(deliveryId);
    }

    return this.mapGithubWebhookDelivery(delivery.row);
  }

  private async receiveSourceWebhook(
    deliveryId: string,
    eventName: string,
    body: unknown
  ): Promise<GithubWebhookDeliveryPayload> {
    const sourceContext = parseGithubSourceWebhookContext(eventName, body);
    if (!sourceContext) {
      const delivery = await this.recordGithubWebhookDelivery({
        deliveryId,
        eventName,
        status: "ignored",
        errorMessage: INVALID_SOURCE_WEBHOOK_CONTEXT_MESSAGE
      });
      return this.mapGithubWebhookDelivery(delivery.row);
    }

    const delivery = await this.recordGithubWebhookDelivery({
      deliveryId,
      eventName,
      status: "received",
      errorMessage: GITHUB_WEBHOOK_ENQUEUE_PENDING_MESSAGE,
      sourceContext
    });

    if (delivery.inserted) {
      const publicationOwner = await this.claimPendingWebhookDeliveryForPublication(
        deliveryId
      );
      if (publicationOwner) {
        await this.enqueueWebhookDelivery(deliveryId, publicationOwner);
      }
    }

    return this.mapGithubWebhookDelivery(delivery.row);
  }

  private async receiveProjectV2ItemWebhook(
    deliveryId: string,
    eventName: string,
    body: unknown
  ): Promise<GithubWebhookDeliveryPayload> {
    const context = parseGithubProjectV2WebhookContext(body);
    if (!context) {
      const delivery = await this.recordGithubWebhookDelivery({
        deliveryId,
        eventName,
        status: "ignored",
        errorMessage: INVALID_PROJECT_V2_ITEM_WEBHOOK_CONTEXT_MESSAGE
      });
      return this.mapGithubWebhookDelivery(delivery.row);
    }

    const selected = await this.findSelectedOrganizationProjectV2(context);
    const status: GithubWebhookDeliveryStatus = selected ? "received" : "ignored";
    const delivery = await this.recordGithubWebhookDelivery({
      deliveryId,
      eventName,
      status,
      errorMessage: selected
        ? GITHUB_WEBHOOK_ENQUEUE_PENDING_MESSAGE
        : UNSELECTED_PROJECT_V2_ITEM_WEBHOOK_MESSAGE,
      context
    });

    if (status === "received" && delivery.inserted) {
      const publicationOwner = await this.claimPendingWebhookDeliveryForPublication(
        deliveryId
      );
      if (publicationOwner) {
        await this.enqueueWebhookDelivery(deliveryId, publicationOwner);
      }
    }

    return this.mapGithubWebhookDelivery(delivery.row);
  }

  private async enqueueWebhookDelivery(
    deliveryId: string,
    publicationOwner?: string
  ): Promise<void> {
    if (!this.syncJobService) return;
    try {
      await this.syncJobService.enqueueWebhookDelivery(deliveryId);
    } catch (error) {
      if (publicationOwner) {
        try {
          await this.releaseWebhookDeliveryForPublication(deliveryId, publicationOwner);
        } catch {
          // The publishing lease expires into a recoverable state when release fails.
        }
      } else {
        await this.database.execute(
          `UPDATE github_webhook_deliveries
           SET status='failed', processed_at=now(), error_message=$2
           WHERE delivery_id=$1
             AND status='received'
             AND error_message IS NULL
             AND lease_owner IS NULL
             AND lease_expires_at IS NULL`,
          [deliveryId, "GitHub webhook could not be enqueued"]
        );
      }
      throw error;
    }

    if (publicationOwner) {
      await this.markWebhookDeliveryPublished(deliveryId, publicationOwner);
    }
  }

  private async prepareFailedWebhookDeliveryForEnqueue(
    deliveryId: string
  ): Promise<boolean> {
    const result = await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          status='received',
          processed_at=NULL,
          error_message=$2,
          lease_owner=NULL,
          lease_expires_at=NULL
        WHERE delivery_id=$1
          AND status='failed'
          AND error_message='GitHub webhook could not be enqueued'
      `,
      [deliveryId, GITHUB_WEBHOOK_ENQUEUE_PENDING_MESSAGE]
    );

    return result.rowCount === 1;
  }

  private async claimPendingWebhookDeliveryForPublication(
    deliveryId: string
  ): Promise<string | null> {
    const publicationOwner = this.nextPublicationOwner();
    const result = await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          error_message='GitHub webhook enqueue is publishing',
          lease_owner=$2,
          lease_expires_at=now() + interval '10 minutes'
        WHERE delivery_id=$1
          AND status='received'
          AND error_message=$3
      `,
      [deliveryId, publicationOwner, GITHUB_WEBHOOK_ENQUEUE_PENDING_MESSAGE]
    );

    return result.rowCount === 1 ? publicationOwner : null;
  }

  private async markWebhookDeliveryPublished(
    deliveryId: string,
    publicationOwner: string
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          error_message=NULL,
          lease_owner=NULL,
          lease_expires_at=NULL
        WHERE delivery_id=$1
          AND status='received'
          AND error_message='GitHub webhook enqueue is publishing'
          AND lease_owner=$2
      `,
      [deliveryId, publicationOwner]
    );
  }

  private async releaseWebhookDeliveryForPublication(
    deliveryId: string,
    publicationOwner: string
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET
          error_message=$3,
          lease_owner=NULL,
          lease_expires_at=NULL
        WHERE delivery_id=$1
          AND status='received'
          AND error_message='GitHub webhook enqueue is publishing'
          AND lease_owner=$2
      `,
      [deliveryId, publicationOwner, GITHUB_WEBHOOK_ENQUEUE_PENDING_MESSAGE]
    );
  }

  private nextPublicationOwner(): string {
    this.publicationAttempt += 1;
    return `${process.env.HOSTNAME ?? "github-webhook"}-${process.pid}-publish-${this.publicationAttempt}`;
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
          error_message,
          action,
          github_installation_id,
          project_v2_node_id,
          project_item_node_id
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
    context?: GithubProjectV2WebhookContext;
    sourceContext?: GithubSourceWebhookContext;
  }): Promise<RecordedGithubWebhookDelivery> {
    const context = input.context;
    if (context) {
      return this.recordGithubProjectV2WebhookDelivery({ ...input, context });
    }
    if (input.sourceContext) {
      return this.recordGithubSourceWebhookDelivery({
        ...input,
        context: input.sourceContext
      });
    }

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
      return { row, inserted: true };
    }

    const existing = await this.findGithubWebhookDelivery(input.deliveryId);
    if (!existing) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return { row: existing, inserted: false };
  }

  private async recordGithubSourceWebhookDelivery(input: {
    deliveryId: string;
    eventName: string;
    status: GithubWebhookDeliveryStatus | "failed";
    errorMessage: string | null;
    context: GithubSourceWebhookContext;
  }): Promise<RecordedGithubWebhookDelivery> {
    // No schema expansion: source deliveries reuse the existing durable locator
    // slots as repository id (project_v2_node_id) and Issue/PR number
    // (project_item_node_id). event_name determines how the worker interprets them.
    const row = await this.database.queryOne<GithubWebhookDeliveryRow>(
      `
        INSERT INTO github_webhook_deliveries (
          delivery_id,
          event_name,
          status,
          action,
          github_installation_id,
          project_v2_node_id,
          project_item_node_id,
          processed_at,
          error_message
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          CASE WHEN $3 = 'received' THEN NULL ELSE now() END,
          $8
        )
        ON CONFLICT (delivery_id)
        DO NOTHING
        RETURNING
          delivery_id,
          event_name,
          status,
          received_at,
          processed_at,
          error_message,
          action,
          github_installation_id,
          project_v2_node_id,
          project_item_node_id
      `,
      [
        input.deliveryId,
        input.eventName,
        input.status,
        input.context.action,
        input.context.githubInstallationId,
        String(input.context.githubRepositoryId),
        String(input.context.contentNumber),
        input.errorMessage
      ]
    );

    if (row) {
      return { row, inserted: true };
    }

    const existing = await this.findGithubWebhookDelivery(input.deliveryId);
    if (!existing) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return { row: existing, inserted: false };
  }

  private async recordGithubProjectV2WebhookDelivery(input: {
    deliveryId: string;
    eventName: string;
    status: GithubWebhookDeliveryStatus | "failed";
    errorMessage: string | null;
    context: GithubProjectV2WebhookContext;
  }): Promise<RecordedGithubWebhookDelivery> {
    const row = await this.database.queryOne<GithubWebhookDeliveryRow>(
      `
        INSERT INTO github_webhook_deliveries (
          delivery_id,
          event_name,
          status,
          action,
          github_installation_id,
          project_v2_node_id,
          project_item_node_id,
          processed_at,
          error_message
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          CASE WHEN $3 = 'received' THEN NULL ELSE now() END,
          $8
        )
        ON CONFLICT (delivery_id)
        DO NOTHING
        RETURNING
          delivery_id,
          event_name,
          status,
          received_at,
          processed_at,
          error_message,
          action,
          github_installation_id,
          project_v2_node_id,
          project_item_node_id
      `,
      [
        input.deliveryId,
        input.eventName,
        input.status,
        input.context.action,
        input.context.githubInstallationId,
        input.context.projectV2NodeId,
        input.context.projectItemNodeId,
        input.errorMessage
      ]
    );

    if (row) {
      return { row, inserted: true };
    }

    const existing = await this.findGithubWebhookDelivery(input.deliveryId);
    if (!existing) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return { row: existing, inserted: false };
  }

  private async findSelectedOrganizationProjectV2(
    context: GithubProjectV2WebhookContext
  ): Promise<boolean> {
    const project = await this.database.queryOne(
      `
        SELECT project.id
        FROM github_installations installation
        JOIN github_projects_v2 project
          ON project.installation_id = installation.id
        JOIN github_project_v2_selections selection
          ON selection.installation_id = installation.id
         AND selection.project_v2_id = project.id
        WHERE installation.github_installation_id = $1
          AND project.github_project_node_id = $2
          AND project.owner_type = 'Organization'
        LIMIT 1
      `,
      [context.githubInstallationId, context.projectV2NodeId]
    );

    return Boolean(project);
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
