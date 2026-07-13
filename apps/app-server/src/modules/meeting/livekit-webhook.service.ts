import { Injectable } from "@nestjs/common";
import { WebhookEvent, WebhookReceiver } from "livekit-server-sdk";
import { QueryResultRow } from "pg";
import { badRequest, unauthorized } from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { MeetingService } from "./meeting.service";

export type LiveKitWebhookDeliveryStatus = "received" | "ignored";

export interface LiveKitWebhookDeliveryPayload {
  deliveryId: string;
  eventName: string;
  status: LiveKitWebhookDeliveryStatus;
  receivedAt: string;
  message: string;
}

interface LiveKitWebhookDeliveryRow extends QueryResultRow {
  delivery_id: string;
  event_name: string;
  status: LiveKitWebhookDeliveryStatus;
  received_at: Date | string;
}

type DeliveryQueryExecutor = DatabaseService | DatabaseTransaction;

const PARTICIPANT_DEPARTURE_EVENTS = new Set([
  "participant_left",
  "participant_connection_aborted"
]);

const LIVEKIT_WEBHOOK_RECEIVED_MESSAGE = "LiveKit webhook received";
const LIVEKIT_WEBHOOK_IGNORED_MESSAGE = "Unsupported LiveKit webhook event ignored";
const INVALID_LIVEKIT_WEBHOOK_SIGNATURE_MESSAGE =
  "Invalid LiveKit webhook signature";

@Injectable()
export class LiveKitWebhookService {
  constructor(
    private readonly database: DatabaseService,
    private readonly meetingService: MeetingService
  ) {}

  async receiveWebhook(
    rawBody: Buffer | undefined,
    authorization: string | undefined
  ): Promise<LiveKitWebhookDeliveryPayload> {
    const body = this.validateRawBody(rawBody);
    this.assertJson(body);
    const event = await this.receiveVerifiedEvent(body, authorization);
    const deliveryId = this.validateRequiredString(event.id, "LiveKit webhook delivery id is required");
    const eventName = this.validateRequiredString(event.event, "LiveKit webhook event name is required");

    const status: LiveKitWebhookDeliveryStatus = PARTICIPANT_DEPARTURE_EVENTS.has(
      eventName
    )
      ? "received"
      : "ignored";
    const result = await this.database.transaction(async (transaction) => {
      const existing = await this.findDelivery(transaction, deliveryId);
      if (existing !== null) {
        return { delivery: existing, job: null, stateEvents: [] };
      }

      const inserted = await this.insertDelivery(transaction, {
        deliveryId,
        eventName,
        roomName: event.room?.name ?? null,
        participantIdentity: event.participant?.identity ?? null,
        status
      });

      if (inserted === null) {
        const recovered = await this.findDelivery(transaction, deliveryId);
        if (recovered === null) {
          throw badRequest("LiveKit webhook delivery could not be recorded");
        }

        return { delivery: recovered, job: null, stateEvents: [] };
      }

      const reconciliation =
        status === "received"
          ? await this.meetingService.reconcileLiveKitParticipantDeparture(
              transaction,
              {
                roomName: this.optionalString(event.room?.name),
                participantIdentity: this.optionalString(event.participant?.identity),
                eventCreatedAt: this.toEventCreatedAt(event.createdAt)
              }
            )
          : { job: null, stateEvents: [] };

      return {
        delivery: inserted,
        job: reconciliation.job,
        stateEvents: reconciliation.stateEvents
      };
    });

    await this.meetingService.enqueueReconciledMeetingReportJob(result.job);
    await this.meetingService.publishReconciledMeetingStateEvents(
      result.stateEvents
    );
    return this.mapDelivery(result.delivery);
  }

  private async receiveVerifiedEvent(
    body: string,
    authorization: string | undefined
  ): Promise<WebhookEvent> {
    try {
      return await new WebhookReceiver(
        this.requireConfig(process.env.LIVEKIT_API_KEY),
        this.requireConfig(process.env.LIVEKIT_API_SECRET)
      ).receive(body, authorization);
    } catch {
      throw unauthorized(INVALID_LIVEKIT_WEBHOOK_SIGNATURE_MESSAGE);
    }
  }

  private async findDelivery(
    executor: DeliveryQueryExecutor,
    deliveryId: string
  ): Promise<LiveKitWebhookDeliveryRow | null> {
    return executor.queryOne<LiveKitWebhookDeliveryRow>(
      `
        SELECT delivery_id, event_name, status, received_at
        FROM livekit_webhook_deliveries
        WHERE delivery_id = $1
        LIMIT 1
      `,
      [deliveryId]
    );
  }

  private async insertDelivery(
    executor: DeliveryQueryExecutor,
    input: {
      deliveryId: string;
      eventName: string;
      roomName: string | null;
      participantIdentity: string | null;
      status: LiveKitWebhookDeliveryStatus;
    }
  ): Promise<LiveKitWebhookDeliveryRow | null> {
    return executor.queryOne<LiveKitWebhookDeliveryRow>(
      `
        INSERT INTO livekit_webhook_deliveries (
          delivery_id,
          event_name,
          room_name,
          participant_identity,
          status
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (delivery_id) DO NOTHING
        RETURNING delivery_id, event_name, status, received_at
      `,
      [
        input.deliveryId,
        input.eventName,
        input.roomName,
        input.participantIdentity,
        input.status
      ]
    );
  }

  private mapDelivery(
    delivery: LiveKitWebhookDeliveryRow
  ): LiveKitWebhookDeliveryPayload {
    return {
      deliveryId: delivery.delivery_id,
      eventName: delivery.event_name,
      status: delivery.status,
      receivedAt: this.toIsoString(delivery.received_at),
      message:
        delivery.status === "ignored"
          ? LIVEKIT_WEBHOOK_IGNORED_MESSAGE
          : LIVEKIT_WEBHOOK_RECEIVED_MESSAGE
    };
  }

  private validateRawBody(rawBody: Buffer | undefined): string {
    if (!rawBody || rawBody.length === 0) {
      throw badRequest("LiveKit webhook raw body is required");
    }

    return rawBody.toString("utf8");
  }

  private assertJson(body: string): void {
    try {
      JSON.parse(body) as unknown;
    } catch {
      throw badRequest("LiveKit webhook payload must be JSON");
    }
  }

  private validateRequiredString(value: string, message: string): string {
    if (!value.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private optionalString(value: string | undefined): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private toEventCreatedAt(value: bigint): Date | null {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds <= 0) {
      return null;
    }

    return new Date(seconds * 1000);
  }

  private requireConfig(value: string | undefined): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("LiveKit webhook is not configured");
    }

    return value.trim();
  }

  private toIsoString(value: Date | string): string {
    return typeof value === "string" ? value : value.toISOString();
  }
}
