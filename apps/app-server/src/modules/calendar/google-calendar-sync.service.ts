import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { AuthConfigService } from "../auth/auth-config.service";
import { DatabaseService, DatabaseTransaction } from "../../database/database.service";
import { GoogleCalendarClient, GoogleCalendarRemoteEvent } from "./google-calendar.client";
import { GoogleCalendarTokenEncryptionService } from "./google-calendar-token-encryption.service";

type SyncOperation = "create" | "update" | "delete";
export interface GoogleCalendarConnectionPayload { connected: boolean; targetCalendarId: string | null; targetCalendarSummary: string | null; }
export interface GoogleCalendarItemPayload { id: string; summary: string; primary: boolean; }
export interface CalendarGoogleSyncEvent { id: number; title: string; description: string | null; isAllDay: boolean; startDate: string; endDate: string; startTime: string | null; endTime: string | null; updatedAt: string; }

interface ConnectionRow extends QueryResultRow { user_id: string; access_token_encrypted: string; refresh_token_encrypted: string; token_expires_at: Date | string | null; target_calendar_id: string | null; target_calendar_summary: string | null; revoked_at: Date | string | null; }
interface OutboxClaim extends QueryResultRow { id: string; calendar_event_id: string | number; connection_user_id: string; operation: SyncOperation; payload: unknown; attempt_count: number; claim_token: string; }
interface SyncRow extends QueryResultRow { google_event_id: string | null; google_calendar_id: string | null; status: "active" | "disconnected" | "failed"; }

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30_000;
const CLAIM_TIMEOUT_SECONDS = 60;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000];

@Injectable()
export class GoogleCalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleCalendarSyncService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly authConfig: AuthConfigService,
    private readonly client: GoogleCalendarClient,
    private readonly encryption: GoogleCalendarTokenEncryptionService
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(() => void this.publishDue().catch(() => this.logger.error("Google Calendar outbox sweep failed")), SWEEP_INTERVAL_MS);
    void this.publishDue().catch(() => this.logger.error("Initial Google Calendar outbox sweep failed"));
  }

  onModuleDestroy(): void { if (this.interval) clearInterval(this.interval); this.interval = null; }

  async getConnection(currentUserId: string): Promise<GoogleCalendarConnectionPayload> {
    const row = await this.connection(currentUserId);
    return { connected: Boolean(row && !row.revoked_at), targetCalendarId: row?.target_calendar_id ?? null, targetCalendarSummary: row?.target_calendar_summary ?? null };
  }

  async startConnection(currentUserId: string, body: unknown): Promise<{ authorizeUrl: string }> {
    const returnPath = this.readReturnPath(body);
    const rawState = randomBytes(32).toString("base64url");
    await this.database.execute(
      `INSERT INTO google_calendar_oauth_states (state_hash, user_id, return_path, expires_at) VALUES ($1, $2, $3, $4)`,
      [this.stateHash(rawState), currentUserId, returnPath, new Date(Date.now() + OAUTH_STATE_TTL_MS)]
    );
    const config = this.authConfig.getProviderConfig("google");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", this.callbackUrl());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
    url.searchParams.set("state", rawState);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    return { authorizeUrl: url.toString() };
  }

  async completeConnection(query: { code?: string; state?: string; error?: string }): Promise<string> {
    if (query.error || !query.code || !query.state) throw badRequest("Google Calendar connection was cancelled");
    const code = query.code;
    const rawState = query.state;
    const state = await this.database.transaction(async transaction => transaction.queryOne<{ user_id: string; return_path: string }>(
      `DELETE FROM google_calendar_oauth_states WHERE state_hash=$1 AND expires_at > now() RETURNING user_id, return_path`, [this.stateHash(rawState)]
    ));
    if (!state) throw badRequest("Invalid Google Calendar OAuth state");
    const config = this.authConfig.getProviderConfig("google");
    const token = await this.client.exchangeCode({ code, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: this.callbackUrl() });
    if (!token.refreshToken) throw badRequest("Google Calendar refresh permission was not granted");
    await this.database.execute(
      `INSERT INTO google_calendar_connections (user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,NULL)
       ON CONFLICT (user_id) DO UPDATE SET access_token_encrypted=EXCLUDED.access_token_encrypted, refresh_token_encrypted=EXCLUDED.refresh_token_encrypted, token_expires_at=EXCLUDED.token_expires_at, revoked_at=NULL, connected_at=now()`,
      [state.user_id, this.encryption.encrypt(token.accessToken), this.encryption.encrypt(token.refreshToken), token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null]
    );
    return state.return_path;
  }

  async listCalendars(currentUserId: string): Promise<GoogleCalendarItemPayload[]> {
    return this.client.listCalendars(await this.accessToken(currentUserId));
  }

  async selectTargetCalendar(currentUserId: string, body: unknown): Promise<GoogleCalendarConnectionPayload> {
    const id = this.requiredString(body, "calendarId");
    const calendar = (await this.listCalendars(currentUserId)).find(item => item.id === id);
    if (!calendar) throw badRequest("Selected Google Calendar was not found");
    const updated = await this.database.execute(`UPDATE google_calendar_connections SET target_calendar_id=$2, target_calendar_summary=$3 WHERE user_id=$1 AND revoked_at IS NULL`, [currentUserId, calendar.id, calendar.summary]);
    if (!updated.rowCount) throw badRequest("Google Calendar is not connected");
    return { connected: true, targetCalendarId: calendar.id, targetCalendarSummary: calendar.summary };
  }

  async disconnect(currentUserId: string): Promise<void> {
    await this.database.transaction(async transaction => {
      await transaction.execute(`UPDATE google_calendar_connections SET revoked_at=now(), target_calendar_id=NULL, target_calendar_summary=NULL WHERE user_id=$1 AND revoked_at IS NULL`, [currentUserId]);
      await transaction.execute(`UPDATE calendar_event_google_syncs SET status='disconnected' WHERE connection_user_id=$1 AND status='active'`, [currentUserId]);
      await transaction.execute(
        `UPDATE calendar_google_sync_outbox SET status='delivered', delivered_at=now(), error_code=NULL, error_message=NULL
         WHERE connection_user_id=$1 AND status='pending'`,
        [currentUserId]
      );
    });
  }

  async enableEventSync(currentUserId: string, workspaceId: string, event: CalendarGoogleSyncEvent): Promise<void> {
    await this.database.transaction(async transaction => {
      await this.lockEventInTransaction(transaction, event.id);
      const connection = await this.activeConnection(transaction, currentUserId);
      if (!connection?.target_calendar_id) throw badRequest("Select a Google Calendar before syncing an event");
      await transaction.execute(
        `INSERT INTO calendar_event_google_syncs (calendar_event_id, workspace_id, connection_user_id, google_calendar_id, status)
         VALUES ($1,$2,$3,$4,'active')
         ON CONFLICT (calendar_event_id) DO UPDATE SET connection_user_id=EXCLUDED.connection_user_id, workspace_id=EXCLUDED.workspace_id, google_calendar_id=EXCLUDED.google_calendar_id, status='active', last_error=NULL`,
        [event.id, workspaceId, currentUserId, connection.target_calendar_id]
      );
      await this.enqueue(transaction, currentUserId, event.id, "create", event);
    });
  }

  async retryEventSync(currentUserId: string, workspaceId: string, event: CalendarGoogleSyncEvent): Promise<void> {
    await this.database.transaction(async transaction => {
      await this.lockEventInTransaction(transaction, event.id);
      const sync = await transaction.queryOne<SyncRow & { connection_user_id: string }>(
        `SELECT connection_user_id, google_event_id, google_calendar_id, status
         FROM calendar_event_google_syncs
         WHERE calendar_event_id=$1 AND workspace_id=$2 FOR UPDATE`,
        [event.id, workspaceId]
      );
      if (!sync || sync.status !== "failed") {
        throw badRequest("Google Calendar sync is not retryable");
      }
      const connection = await this.activeConnection(transaction, sync.connection_user_id);
      const googleCalendarId = sync.google_calendar_id ?? connection?.target_calendar_id;
      if (!connection || !googleCalendarId) throw badRequest("Google Calendar is not connected");
      const operation: SyncOperation = sync.google_event_id ? "update" : "create";
      await transaction.execute(`UPDATE calendar_event_google_syncs SET status='active', google_calendar_id=$2, last_error=NULL WHERE calendar_event_id=$1`, [event.id, googleCalendarId]);
      await this.requeueFailedSyncInTransaction(transaction, event.id, sync.connection_user_id, operation);
    });
  }

  async enqueueUpdatedEventInTransaction(transaction: DatabaseTransaction, workspaceId: string, event: CalendarGoogleSyncEvent): Promise<void> {
    await this.lockEventInTransaction(transaction, event.id);
    const sync = await transaction.queryOne<{ connection_user_id: string }>(`SELECT connection_user_id FROM calendar_event_google_syncs WHERE calendar_event_id=$1 AND workspace_id=$2 AND status='active'`, [event.id, workspaceId]);
    if (sync) await this.enqueue(transaction, sync.connection_user_id, event.id, "update", event);
  }

  async enqueueDeletedEventInTransaction(transaction: DatabaseTransaction, workspaceId: string, event: CalendarGoogleSyncEvent): Promise<void> {
    await this.lockEventInTransaction(transaction, event.id);
    const sync = await transaction.queryOne<{ connection_user_id: string; google_event_id: string | null }>(
      `SELECT connection_user_id, google_event_id FROM calendar_event_google_syncs WHERE calendar_event_id=$1 AND workspace_id=$2 AND status='active' FOR UPDATE`,
      [event.id, workspaceId]
    );
    if (!sync) return;
    await transaction.execute(`UPDATE calendar_event_google_syncs SET status='disconnected' WHERE calendar_event_id=$1`, [event.id]);
    if (!sync.google_event_id) {
      await transaction.execute(
        `UPDATE calendar_google_sync_outbox SET status='delivered', delivered_at=now(), error_code=NULL, error_message=NULL
         WHERE calendar_event_id=$1 AND status='pending' AND operation IN ('create', 'update')`,
        [event.id]
      );
      return;
    }
    await this.enqueue(transaction, sync.connection_user_id, event.id, "delete", event);
  }

  async publishDue(): Promise<void> {
    const ids = await this.database.query<{ id: string }>(
      `SELECT outbox.id FROM calendar_google_sync_outbox AS outbox
       WHERE ((outbox.status='pending' AND outbox.next_attempt_at <= now())
          OR (outbox.status='publishing' AND outbox.claimed_at <= now() - ($1 * INTERVAL '1 second')))
         AND NOT EXISTS (
           SELECT 1 FROM calendar_google_sync_outbox AS earlier
           WHERE earlier.calendar_event_id=outbox.calendar_event_id
             AND earlier.created_at < outbox.created_at
             AND earlier.status IN ('pending', 'publishing')
         )
       ORDER BY outbox.created_at LIMIT 20`,
      [CLAIM_TIMEOUT_SECONDS]
    );
    for (const row of ids) await this.publishOne(row.id);
  }

  private async publishOne(id: string): Promise<void> {
    const claim = await this.claim(id); if (!claim) return;
    try {
      await this.database.withAdvisoryLock(BigInt(claim.calendar_event_id), () => this.publishClaim(claim));
    } catch (error) { await this.retry(claim, error); }
  }

  private async publishClaim(claim: OutboxClaim): Promise<void> {
      const payload = this.payload(claim.payload);
      const sync = await this.database.queryOne<SyncRow>(`SELECT google_event_id, google_calendar_id, status FROM calendar_event_google_syncs WHERE calendar_event_id=$1`, [claim.calendar_event_id]);
      if (claim.operation === "create") {
        if (!sync || sync.status !== "active") return await this.deliverWithoutRemoteCall(claim);
      }
      if (!sync?.google_calendar_id) throw new Error("Google Calendar destination is unavailable");
      const connection = await this.connection(claim.connection_user_id);
      if (!connection || connection.revoked_at) throw new Error("Google Calendar connection is unavailable");
      const token = await this.accessToken(claim.connection_user_id, connection);
      if (claim.operation === "create") {
        const remoteId = await this.client.insertEvent(token, sync.google_calendar_id, this.remoteEvent(payload));
        await this.database.execute(`UPDATE calendar_event_google_syncs SET google_event_id=$2, last_synced_at=now(), last_error=NULL WHERE calendar_event_id=$1`, [claim.calendar_event_id, remoteId]);
      } else if (claim.operation === "update") {
        if (!sync || sync.status !== "active" || !sync.google_event_id) throw new Error("Google Calendar event is not ready for update");
        await this.client.updateEvent(token, sync.google_calendar_id, sync.google_event_id, this.remoteEvent(payload));
        await this.database.execute(`UPDATE calendar_event_google_syncs SET last_synced_at=now(), last_error=NULL WHERE calendar_event_id=$1`, [claim.calendar_event_id]);
      } else if (sync?.google_event_id && claim.operation === "delete") {
        await this.client.deleteEvent(token, sync.google_calendar_id, sync.google_event_id);
        await this.database.execute(`UPDATE calendar_event_google_syncs SET status='disconnected', last_synced_at=now(), last_error=NULL WHERE calendar_event_id=$1`, [claim.calendar_event_id]);
      }
      await this.database.execute(`UPDATE calendar_google_sync_outbox SET status='delivered', delivered_at=now(), claim_token=NULL, claimed_at=NULL WHERE id=$1 AND claim_token=$2`, [claim.id, claim.claim_token]);
  }

  private async claim(id: string): Promise<OutboxClaim | null> {
    const token = randomUUID();
    return this.database.transaction(transaction => transaction.queryOne<OutboxClaim>(
      `WITH candidate AS (
         SELECT outbox.id FROM calendar_google_sync_outbox AS outbox
         WHERE outbox.id=$1
           AND ((outbox.status='pending' AND outbox.next_attempt_at <= now())
             OR (outbox.status='publishing' AND outbox.claimed_at <= now() - ($2 * INTERVAL '1 second')))
           AND NOT EXISTS (
             SELECT 1 FROM calendar_google_sync_outbox AS earlier
             WHERE earlier.calendar_event_id=outbox.calendar_event_id
               AND earlier.created_at < outbox.created_at
               AND earlier.status IN ('pending', 'publishing')
           )
         FOR UPDATE SKIP LOCKED
       )
       UPDATE calendar_google_sync_outbox AS outbox SET status='publishing', attempt_count=outbox.attempt_count+1, claim_token=$3, claimed_at=now() FROM candidate WHERE outbox.id=candidate.id
       RETURNING outbox.id, outbox.calendar_event_id, outbox.connection_user_id, outbox.operation, outbox.payload, outbox.attempt_count, outbox.claim_token`, [id, CLAIM_TIMEOUT_SECONDS, token]
    ));
  }

  private async retry(claim: OutboxClaim, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Google Calendar sync failed";
    const status = claim.attempt_count >= MAX_RETRIES ? "failed" : "pending";
    const next = new Date(Date.now() + RETRY_DELAYS_MS[Math.max(0, claim.attempt_count - 1)]);
    await this.database.execute(`UPDATE calendar_google_sync_outbox SET status=$3, next_attempt_at=$4, claim_token=NULL, claimed_at=NULL, error_code='GOOGLE_CALENDAR_SYNC_FAILED', error_message=$5 WHERE id=$1 AND claim_token=$2`, [claim.id, claim.claim_token, status, next, message]);
    if (status === "failed") await this.database.execute(`UPDATE calendar_event_google_syncs SET status='failed', last_error=$2 WHERE calendar_event_id=$1`, [claim.calendar_event_id, message]);
  }

  private async deliverWithoutRemoteCall(claim: OutboxClaim): Promise<void> {
    await this.database.execute(`UPDATE calendar_google_sync_outbox SET status='delivered', delivered_at=now(), claim_token=NULL, claimed_at=NULL WHERE id=$1 AND claim_token=$2`, [claim.id, claim.claim_token]);
  }

  private async enqueue(transaction: DatabaseTransaction, userId: string, eventId: number, operation: SyncOperation, event: CalendarGoogleSyncEvent): Promise<void> {
    await transaction.execute(`INSERT INTO calendar_google_sync_outbox (calendar_event_id, connection_user_id, operation, payload, dedupe_key) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (connection_user_id, dedupe_key) DO NOTHING`, [eventId, userId, operation, JSON.stringify(event), `calendar:google_${operation}:${eventId}:${event.updatedAt}`]);
  }

  private async requeueFailedSyncInTransaction(
    transaction: DatabaseTransaction,
    eventId: number,
    connectionUserId: string,
    operation: SyncOperation
  ): Promise<void> {
    const requeued = await transaction.queryOne<{ id: string }>(
      `WITH failed AS (
         SELECT id FROM calendar_google_sync_outbox
         WHERE calendar_event_id=$1 AND connection_user_id=$2 AND operation=$3 AND status='failed'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE
       )
       UPDATE calendar_google_sync_outbox AS outbox
       SET status='pending', attempt_count=0, next_attempt_at=now(), claim_token=NULL, claimed_at=NULL,
           delivered_at=NULL, error_code=NULL, error_message=NULL
       FROM failed
       WHERE outbox.id=failed.id
       RETURNING outbox.id`,
      [eventId, connectionUserId, operation]
    );
    if (!requeued) throw badRequest("Google Calendar sync is not retryable");
  }

  private async accessToken(userId: string, existing?: ConnectionRow): Promise<string> {
    const connection = existing ?? await this.connection(userId);
    if (!connection || connection.revoked_at) throw badRequest("Google Calendar is not connected");
    const expiry = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
    if (expiry > Date.now() + 60_000) return this.encryption.decrypt(connection.access_token_encrypted);
    const config = this.authConfig.getProviderConfig("google");
    const refreshed = await this.client.refresh({ refreshToken: this.encryption.decrypt(connection.refresh_token_encrypted), clientId: config.clientId, clientSecret: config.clientSecret });
    await this.database.execute(`UPDATE google_calendar_connections SET access_token_encrypted=$2, token_expires_at=$3 WHERE user_id=$1`, [userId, this.encryption.encrypt(refreshed.accessToken), refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : null]);
    return refreshed.accessToken;
  }

  private connection(userId: string): Promise<ConnectionRow | null> { return this.database.queryOne<ConnectionRow>(`SELECT user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, target_calendar_id, target_calendar_summary, revoked_at FROM google_calendar_connections WHERE user_id=$1`, [userId]); }
  private activeConnection(transaction: DatabaseTransaction, userId: string): Promise<ConnectionRow | null> { return transaction.queryOne<ConnectionRow>(`SELECT user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, target_calendar_id, target_calendar_summary, revoked_at FROM google_calendar_connections WHERE user_id=$1 AND revoked_at IS NULL FOR UPDATE`, [userId]); }
  private callbackUrl(): string { const config = this.authConfig.getProviderConfig("google"); return `${config.apiPublicOrigin}${config.apiBasePath}/calendar/google/callback`; }
  private stateHash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
  private readReturnPath(body: unknown): string {
    const value = body && typeof body === "object" && "returnPath" in body ? (body as { returnPath?: unknown }).returnPath : "/calendar";
    if (value === undefined) return "/calendar";
    if (typeof value !== "string" || value.length > 2048) throw badRequest("returnPath must be a frontend path");
    try {
      const frontend = this.authConfig.getFrontendUrl();
      const resolved = new URL(value, frontend);
      if (resolved.origin !== frontend || !value.startsWith("/")) throw new Error();
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
      throw badRequest("returnPath must be a frontend path");
    }
  }
  private requiredString(body: unknown, field: string): string { const value = body && typeof body === "object" && field in body ? (body as Record<string, unknown>)[field] : undefined; if (typeof value !== "string" || !value.trim() || value.length > 1024) throw badRequest(`${field} is required`); return value.trim(); }
  private payload(value: unknown): CalendarGoogleSyncEvent { if (!value || typeof value !== "object") throw badRequest("Google Calendar sync payload is invalid"); return value as CalendarGoogleSyncEvent; }
  private remoteEvent(event: CalendarGoogleSyncEvent): GoogleCalendarRemoteEvent { const description = event.description?.slice(0, 8_000) || undefined; const id = `pilo${event.id}`; if (event.isAllDay) return { id, summary: event.title, description, start: { date: event.startDate }, end: { date: this.addDays(event.endDate, 1) } }; return { id, summary: event.title, description, start: { dateTime: `${event.startDate}T${event.startTime}:00`, timeZone: "Asia/Seoul" }, end: { dateTime: `${event.endDate}T${event.endTime}:00`, timeZone: "Asia/Seoul" } }; }
  private async lockEventInTransaction(transaction: DatabaseTransaction, eventId: number): Promise<void> { await transaction.execute("SELECT pg_advisory_xact_lock($1::bigint)", [eventId]); }
  private addDays(date: string, days: number): string { const [year, month, day] = date.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); }
}
