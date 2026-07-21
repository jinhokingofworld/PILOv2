import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  badRequest,
  conflict,
  notFound,
  payloadTooLarge,
  sqlErdWriteProtocolMismatch
} from "../../common/api-error";
import {
  ActivityLogInput,
  ActivityLogService
} from "../../common/activity-log.service";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { encodeSqlErdSessionCursor } from "./sql-erd.cursor";
import {
  buildSqlErdNoteActivities,
  buildSqlErdSessionChangedActivities,
  buildSqlErdSessionCreatedActivities,
  buildSqlErdSessionDeletedActivity
} from "./sql-erd-activity-log";
import {
  mapDeletedSqlErdSession,
  mapSqlErdSession,
  mapSqlErdSessionSummary
} from "./sql-erd.mapper";
import { applySqlErdLayoutPatch } from "./sql-erd-layout-patch";
import { createSqlErdModelFingerprint } from "./sql-erd-model-fingerprint";
import { mapSqlErdOperation } from "./sql-erd-operation.mapper";
import {
  validateCreateSqlErdOperationRequest,
  validateListSqlErdOperationsQuery
} from "./sql-erd-operation.validation";
import { rebaseSqlErdSourceLayout } from "./sql-erd-source-rebase";
import { generateSqlErdSchema } from "./sql-erd-schema-generator";
import {
  SqlErdAgentSchemaReplacementPayload,
  SqlErdAgentSessionCreationPayload,
  SqlErdSchemaSpecV1
} from "./sql-erd-schema-spec.types";
import { validateSqlErdSchemaSpec } from "./sql-erd-schema-spec.validation";
import {
  validateAcquireSqlErdSourceLockRequest,
  validateReleaseSqlErdSourceLockRequest,
  validateRenewSqlErdSourceLockRequest,
  validateSqlErdSourcePublishRequest,
  validateSqlErdSourceSnapshotBatchQuery
} from "./sql-erd-source-snapshot.validation";
import {
  CreateSqlErdOperationRequest,
  AcquireSqlErdSourceLockRequest,
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  ListSqlErdOperationsQuery,
  ListSqlErdSessionsQuery,
  NormalizedCreateSqlErdSessionInput,
  NormalizedSqlErdOperationInput,
  NormalizedSqlErdSourcePublishInput,
  NormalizedUpdateSqlErdSessionInput,
  SqlErdDeletedSessionPayload,
  SqlErdOperationListPayload,
  SqlErdOperationRow,
  SqlErdOperationWritePayload,
  SqlErdJsonObject,
  SqlErdSourceLockPayload,
  SqlErdSourceLockRow,
  SqlErdSourcePublishPayload,
  NormalizedSqlErdSourceSnapshotBatchInput,
  SqlErdSourceSnapshotPayload,
  SqlErdSourceSnapshotRow,
  ReleaseSqlErdSourceLockRequest,
  RenewSqlErdSourceLockRequest,
  SourcePublishRequest,
  SourceSnapshotBatchQuery,
  SqlErdSessionListPayload,
  SqlErdSessionPayload,
  SqlErdSessionRow,
  SqlErdSessionSummaryRow,
  SqlErdWriteProtocol,
  UpdateSqlErdSessionMetadataRequest,
  UpdateSqlErdSessionRequest
} from "./sql-erd.types";
import {
  validateCreateSqlErdSessionRequest,
  validateDeleteSqlErdSessionQuery,
  validateListSqlErdSessionsQuery,
  validateSqlErdLayoutJson,
  validateSqlErdSessionId,
  validateUpdateSqlErdSessionMetadataRequest,
  validateUpdateSqlErdSessionRequest
} from "./sql-erd.validation";

const SQL_ERD_SESSION_SELECT = `
  SELECT
    id,
    workspace_id,
    title,
    source_format,
    dialect,
    source_text,
    model_json,
    layout_json,
    settings_json,
    table_count,
    relation_count,
    revision,
    write_protocol,
    latest_op_seq,
    created_by,
    updated_by,
    created_at,
    updated_at,
    deleted_at
  FROM sql_erd_sessions
`;
const SQL_ERD_SESSION_SUMMARY_SELECT = `
  SELECT
    id,
    workspace_id,
    title,
    source_format,
    dialect,
    table_count,
    relation_count,
    revision,
    created_by,
    updated_by,
    created_at,
    updated_at,
    to_char(
      updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) AS cursor_updated_at
  FROM sql_erd_sessions
`;
const UNIQUE_VIOLATION_CODE = "23505";
const CHECK_VIOLATION_CODE = "23514";
const JSON_SIZE_CONSTRAINTS = new Set([
  "sql_erd_sessions_model_json_size_check",
  "sql_erd_sessions_layout_json_size_check",
  "sql_erd_sessions_settings_json_size_check",
  "sql_erd_source_snapshots_source_text_size_check",
  "sql_erd_source_snapshots_model_json_size_check",
  "sql_erd_source_snapshots_layout_json_size_check",
  "sql_erd_source_snapshots_total_size_check"
]);
const SOURCE_LOCK_TTL_SECONDS = 30;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SqlErdSourceSnapshotWriteInput = Omit<
  NormalizedSqlErdSourcePublishInput,
  "leaseId"
>;
export interface SqlErdAgentReplacementExpectedState {
  revision: number;
  modelFingerprint: string;
}
export const MAX_SQL_ERD_SOURCE_SNAPSHOT_BATCH_RESPONSE_BYTES = 10 * 1024 * 1024;

export function resolveNewSqlErdWriteProtocol(): SqlErdWriteProtocol {
  return process.env.SQL_ERD_OPERATIONS_V1_ENABLED === "true"
    ? "operations_v1"
    : "snapshot";
}

const SQL_ERD_OPERATION_SELECT = `
  SELECT
    id,
    workspace_id,
    session_id,
    actor_user_id,
    operation_type,
    op_seq,
    client_operation_id,
    base_revision,
    applied_on_revision,
    result_revision,
    payload,
    request_fingerprint,
    source_snapshot_id,
    created_at
  FROM sql_erd_session_operations
`;
const SQL_ERD_SOURCE_SNAPSHOT_SELECT = `
  SELECT
    id,
    workspace_id,
    session_id,
    source_format,
    dialect,
    source_text,
    model_json,
    layout_json,
    table_count,
    relation_count,
    base_revision,
    result_revision,
    created_by,
    created_at
  FROM sql_erd_session_source_snapshots
`;

@Injectable()
export class SqlErdService {
  private readonly logger = new Logger(SqlErdService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly activityLogService: ActivityLogService
  ) {}

  getModuleInfo() {
    return {
      domain: "sqltoerd",
      apiContract: "docs/api/sqltoerd-api.md"
    };
  }

  async getActiveSession(
    currentUserId: string,
    workspaceId: string
  ): Promise<SqlErdSessionPayload | null> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findActiveSession(workspaceId);
    return session ? mapSqlErdSession(session) : null;
  }

  async listSessions(
    currentUserId: string,
    workspaceId: string,
    query: ListSqlErdSessionsQuery
  ): Promise<SqlErdSessionListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateListSqlErdSessionsQuery(query);
    const rows = await this.database.query<SqlErdSessionSummaryRow>(
      `
        ${SQL_ERD_SESSION_SUMMARY_SELECT}
        WHERE workspace_id = $1
          AND deleted_at IS NULL
          AND (
            $2::timestamptz IS NULL
            OR (updated_at, id) < ($2::timestamptz, $3::uuid)
          )
        ORDER BY updated_at DESC, id DESC
        LIMIT $4
      `,
      [
        workspaceId,
        input.cursor?.updatedAt ?? null,
        input.cursor?.id ?? null,
        input.limit + 1
      ]
    );
    const hasNextPage = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map(mapSqlErdSessionSummary),
      nextCursor:
        hasNextPage && lastRow
          ? encodeSqlErdSessionCursor({
              updatedAt: lastRow.cursor_updated_at,
              id: lastRow.id
            })
          : null
    };
  }

  async getSession(
    currentUserId: string,
    workspaceId: string,
    sessionId: string
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validSessionId = validateSqlErdSessionId(sessionId);
    const session = await this.findActiveSessionById(workspaceId, validSessionId);
    if (!session) {
      throw notFound("sqltoerd session not found");
    }

    return mapSqlErdSession(session);
  }

  async listOperations(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    query: ListSqlErdOperationsQuery
  ): Promise<SqlErdOperationListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateListSqlErdOperationsQuery(query);
    return this.database.transaction(async (transaction) => {
      // A row lock prevents a writer from committing a higher sequence between
      // the session watermark read and the operation page query.
      const session = await this.findActiveSessionById(
        workspaceId,
        validSessionId,
        transaction,
        true
      );
      if (!session) throw notFound("sqltoerd session not found");
      const rows = await transaction.query<SqlErdOperationRow>(
        `${SQL_ERD_OPERATION_SELECT} WHERE workspace_id = $1 AND session_id = $2 AND op_seq > $3 ORDER BY op_seq ASC LIMIT $4`,
        [workspaceId, validSessionId, input.afterSeq, input.limit + 1]
      );
      const pageRows = rows.slice(0, input.limit);
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map(mapSqlErdOperation),
        latestOpSeq: Number(session.latest_op_seq),
        nextAfterSeq: rows.length > input.limit && lastRow ? Number(lastRow.op_seq) : null
      };
    });
  }

  async createOperation(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: CreateSqlErdOperationRequest
  ): Promise<SqlErdOperationWritePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateCreateSqlErdOperationRequest(body);

    try {
      return await this.database.transaction(async (transaction) => {
        const session = await this.findActiveSessionById(
          workspaceId,
          validSessionId,
          transaction,
          true
        );
        if (!session) {
          throw notFound("sqltoerd session not found");
        }
        if (session.write_protocol !== "operations_v1") {
          throw sqlErdWriteProtocolMismatch();
        }

        const existingOperation = await this.findOperationByClientOperationId(
          transaction,
          validSessionId,
          currentUserId,
          input.clientOperationId
        );
        if (existingOperation) {
          return this.mapOperationWriteResult(session, existingOperation);
        }

        const currentRevision = Number(session.revision);
        if (input.baseRevision > currentRevision) {
          throw conflict("sqltoerd operation baseRevision is ahead of the session");
        }

        const layoutJson = applySqlErdLayoutPatch(session.layout_json, input.patch);
        validateSqlErdLayoutJson(layoutJson, session.model_json);

        const updatedSession = await this.applyOperationLayoutPatch(
          transaction,
          session,
          currentUserId,
          input,
          layoutJson
        );
        if (!updatedSession) {
          throw conflict("sqltoerd session revision conflict");
        }

        const operation = await this.insertOperation(
          transaction,
          updatedSession,
          currentUserId,
          input,
          currentRevision
        );
        if (!operation) {
          throw conflict("sqltoerd operation could not be recorded");
        }

        await transaction.execute(
          `
            INSERT INTO sql_erd_session_operation_outbox (operation_id)
            VALUES ($1)
          `,
          [operation.id]
        );

        await this.appendActivities(
          transaction,
          buildSqlErdNoteActivities({
            workspaceId,
            sessionId: validSessionId,
            actor: { type: "user", userId: currentUserId },
            beforeLayout: session.layout_json,
            afterLayout: updatedSession.layout_json,
            resultRevision: Number(updatedSession.revision)
          })
        );

        return this.mapOperationWriteResult(updatedSession, operation);
      });
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd JSON payload is too large");
      }
      throw error;
    }
  }

  async acquireSourceLock(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: AcquireSqlErdSourceLockRequest
  ): Promise<SqlErdSourceLockPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateAcquireSqlErdSourceLockRequest(body);

    return this.database.transaction(async (transaction) => {
      const session = await this.requireOperationsSession(
        transaction,
        workspaceId,
        validSessionId
      );
      const existingLock = await this.findActiveSourceLock(transaction, workspaceId, validSessionId);
      if (existingLock) {
        if (
          existingLock.actor_user_id === currentUserId &&
          existingLock.lease_id === input.leaseId
        ) {
          return mapSqlErdSourceLock(existingLock);
        }
        throw conflict("sqltoerd source lock is unavailable");
      }
      await transaction.execute(
        `DELETE FROM sql_erd_session_source_locks
         WHERE workspace_id = $1 AND session_id = $2 AND expires_at <= now()`,
        [workspaceId, validSessionId]
      );

      const lock = await transaction.queryOne<SqlErdSourceLockRow>(
        `
          INSERT INTO sql_erd_session_source_locks (
            workspace_id,
            session_id,
            lease_id,
            actor_user_id,
            source_base_revision,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 second'))
          RETURNING workspace_id, session_id, lease_id, actor_user_id, source_base_revision,
            expires_at, created_at, updated_at
        `,
        [
          workspaceId,
          validSessionId,
          input.leaseId,
          currentUserId,
          Number(session.revision),
          SOURCE_LOCK_TTL_SECONDS
        ]
      );
      if (!lock) throw conflict("sqltoerd source lock could not be acquired");
      return mapSqlErdSourceLock(lock);
    });
  }

  async renewSourceLock(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: RenewSqlErdSourceLockRequest
  ): Promise<SqlErdSourceLockPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateRenewSqlErdSourceLockRequest(body);

    return this.database.transaction(async (transaction) => {
      await this.requireOperationsSession(transaction, workspaceId, validSessionId);
      const lock = await transaction.queryOne<SqlErdSourceLockRow>(
        `
          UPDATE sql_erd_session_source_locks
          SET expires_at = now() + ($4 * interval '1 second')
          WHERE workspace_id = $1
            AND session_id = $2
            AND actor_user_id = $3
            AND lease_id = $5
            AND expires_at > now()
          RETURNING workspace_id, session_id, lease_id, actor_user_id, source_base_revision,
            expires_at, created_at, updated_at
        `,
        [workspaceId, validSessionId, currentUserId, SOURCE_LOCK_TTL_SECONDS, input.leaseId]
      );
      if (!lock) throw conflict("sqltoerd source lock is unavailable");
      return mapSqlErdSourceLock(lock);
    });
  }

  async releaseSourceLock(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: ReleaseSqlErdSourceLockRequest
  ): Promise<void> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateReleaseSqlErdSourceLockRequest(body);

    await this.database.transaction(async (transaction) => {
      await this.requireOperationsSession(transaction, workspaceId, validSessionId);
      const activeLock = await this.findActiveSourceLock(transaction, workspaceId, validSessionId);
      if (activeLock && (activeLock.actor_user_id !== currentUserId || activeLock.lease_id !== input.leaseId)) {
        throw conflict("sqltoerd source lock is unavailable");
      }
      if (!activeLock) {
        await transaction.execute(
          `DELETE FROM sql_erd_session_source_locks
           WHERE workspace_id = $1 AND session_id = $2 AND actor_user_id = $3
             AND lease_id = $4 AND expires_at <= now()`,
          [workspaceId, validSessionId, currentUserId, input.leaseId]
        );
        return;
      }
      await transaction.execute(
        `
          DELETE FROM sql_erd_session_source_locks
          WHERE workspace_id = $1
            AND session_id = $2
            AND actor_user_id = $3
            AND lease_id = $4
            AND expires_at > now()
        `,
        [workspaceId, validSessionId, currentUserId, input.leaseId]
      );
    });
  }

  async publishSourceSnapshot(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: SourcePublishRequest
  ): Promise<SqlErdSourcePublishPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateSqlErdSourcePublishRequest(body);
    const requestFingerprint = createSourcePublishFingerprint(input);

    try {
      return await this.database.transaction(async (transaction) => {
        const session = await this.requireOperationsSession(
          transaction,
          workspaceId,
          validSessionId
        );
        const existingOperation = await this.findOperationByClientOperationId(
          transaction,
          validSessionId,
          currentUserId,
          input.clientOperationId
        );
        if (existingOperation) {
          return this.mapExistingSourcePublish(
            transaction,
            existingOperation,
            requestFingerprint
          );
        }

        const sourceLock = await this.findOwnedActiveSourceLock(
          transaction,
          workspaceId,
          validSessionId,
          currentUserId,
          input.leaseId
        );
        if (!sourceLock) {
          throw conflict("sqltoerd source lock is unavailable");
        }
        if (Number(sourceLock.source_base_revision) !== input.baseRevision) {
          throw conflict("sqltoerd source publish baseRevision conflict");
        }

        const rebased = rebaseSqlErdSourceLayout({
          currentLayout: session.layout_json,
          nextModel: input.modelJson
        });
        const currentRevision = Number(session.revision);
        const updatedSession = await this.applySourceSnapshot(
          transaction,
          session,
          currentUserId,
          input,
          rebased.layoutJson
        );
        if (!updatedSession) throw conflict("sqltoerd session revision conflict");

        const snapshot = await this.insertSourceSnapshot(
          transaction,
          updatedSession,
          currentUserId,
          input,
          currentRevision,
          rebased.layoutJson
        );
        if (!snapshot) throw conflict("sqltoerd source snapshot could not be recorded");

        const operation = await this.insertSourceSnapshotOperation(
          transaction,
          updatedSession,
          currentUserId,
          input,
          currentRevision,
          snapshot.id,
          requestFingerprint,
          rebased.summary
        );
        if (!operation) throw conflict("sqltoerd source operation could not be recorded");

        await transaction.execute(
          `
            INSERT INTO sql_erd_session_operation_outbox (operation_id)
            VALUES ($1)
          `,
          [operation.id]
        );
        await transaction.execute(
          `
            UPDATE sql_erd_session_source_locks
            SET source_base_revision = $5
            WHERE workspace_id = $1
              AND session_id = $2
              AND actor_user_id = $3
              AND lease_id = $4
          `,
          [
            workspaceId,
            validSessionId,
            currentUserId,
            input.leaseId,
            Number(updatedSession.revision)
          ]
        );

        await this.appendActivities(
          transaction,
          buildSqlErdSessionChangedActivities({
            workspaceId,
            actor: { type: "user", userId: currentUserId },
            before: session,
            after: updatedSession
          }).filter(({ action }) => action === "sql_erd_schema_updated")
        );

        return {
          ...this.mapOperationWriteResult(updatedSession, operation),
          snapshot: mapSqlErdSourceSnapshot(snapshot),
          rebaseSummary: rebased.summary
        };
      });
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd source snapshot payload is too large");
      }
      throw error;
    }
  }

  async listSourceSnapshots(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    query: SourceSnapshotBatchQuery
  ): Promise<SqlErdSourceSnapshotPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateSqlErdSourceSnapshotBatchQuery(query);
    await this.assertSourceSnapshotSessionExists(workspaceId, validSessionId);
    const rows = await this.database.query<SqlErdSourceSnapshotRow>(
      `
        ${SQL_ERD_SOURCE_SNAPSHOT_SELECT}
        WHERE workspace_id = $1 AND session_id = $2 AND id = ANY($3::uuid[])
        ORDER BY array_position($3::uuid[], id)
      `,
      [workspaceId, validSessionId, input.ids]
    );
    if (rows.length !== input.ids.length) {
      throw notFound("sqltoerd source snapshot not found");
    }
    const snapshots = rows.map(mapSqlErdSourceSnapshot);
    assertSourceSnapshotBatchResponseSize(snapshots);
    return snapshots;
  }

  async createSession(
    currentUserId: string,
    workspaceId: string,
    body: CreateSqlErdSessionRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateCreateSqlErdSessionRequest(body);
    return this.createSessionWithWorkspaceLock(
      workspaceId,
      currentUserId,
      input,
      true
    );
  }

  async createAgentGeneratedSession(
    currentUserId: string,
    workspaceId: string,
    agentRunId: string,
    schemaSpec: unknown
  ): Promise<SqlErdAgentSessionCreationPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validAgentRunId = validateAgentRunId(agentRunId);
    const normalizedSpec = validateSqlErdSchemaSpec(schemaSpec);
    const generated = generateSqlErdSchema(normalizedSpec);
    const requestFingerprint = createAgentSchemaFingerprint(normalizedSpec);

    try {
      const session = await this.database.transaction(async (transaction) => {
        const workspace = await transaction.queryOne<{ id: string }>(
          `
            SELECT id
            FROM workspaces
            WHERE id = $1
            FOR UPDATE
          `,
          [workspaceId]
        );
        if (!workspace) {
          throw notFound("Workspace not found");
        }

        const existing = await transaction.queryOne<{
          request_fingerprint: string;
          session_id: string;
        }>(
          `
            SELECT request_fingerprint, session_id
            FROM sql_erd_agent_session_creations
            WHERE workspace_id = $1
              AND actor_user_id = $2
              AND agent_run_id = $3
          `,
          [workspaceId, currentUserId, validAgentRunId]
        );
        if (existing) {
          if (existing.request_fingerprint !== requestFingerprint) {
            throw conflict("sqltoerd agentRunId was reused with different schema input");
          }
          const existingSession = await this.findActiveSessionById(
            workspaceId,
            existing.session_id,
            transaction
          );
          if (!existingSession) {
            throw conflict("sqltoerd agent-created session is unavailable");
          }
          return existingSession;
        }

        const createdSession = await this.insertSession(
          transaction,
          workspaceId,
          currentUserId,
          {
            title: generated.title,
            sourceFormat: "sql",
            dialect: generated.dialect,
            sourceText: generated.sourceText,
            modelJson: generated.modelJson,
            layoutJson: generated.layoutJson,
            settingsJson: {},
            tableCount: generated.tableCount,
            relationCount: generated.relationCount
          }
        );
        if (!createdSession) {
          throw badRequest("sqltoerd agent session could not be created");
        }

        await transaction.execute(
          `
            INSERT INTO sql_erd_agent_session_creations (
              workspace_id,
              actor_user_id,
              agent_run_id,
              request_fingerprint,
              session_id
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            workspaceId,
            currentUserId,
            validAgentRunId,
            requestFingerprint,
            createdSession.id
          ]
        );

        await this.appendActivities(
          transaction,
          buildSqlErdSessionCreatedActivities({
            workspaceId,
            actor: { type: "agent", userId: currentUserId },
            session: createdSession
          })
        );

        return createdSession;
      });

      return {
        session: mapSqlErdSession(session),
        warnings: generated.warnings
      };
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd generated session payload is too large");
      }
      throw error;
    }
  }

  async replaceAgentGeneratedSchema(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    agentRunId: string,
    schemaSpec: unknown,
    expectedState: SqlErdAgentReplacementExpectedState
  ): Promise<SqlErdAgentSchemaReplacementPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const validSessionId = validateSqlErdSessionId(sessionId);
    const validAgentRunId = validateAgentRunId(agentRunId);
    const normalizedSpec = validateSqlErdSchemaSpec(schemaSpec);
    const requestFingerprint = createAgentSchemaFingerprint(normalizedSpec);
    if (
      !Number.isInteger(expectedState.revision) ||
      expectedState.revision < 1 ||
      !/^fnv1a32:[0-9a-f]{8}$/.test(expectedState.modelFingerprint)
    ) {
      throw badRequest("sqltoerd expected session state is invalid");
    }

    try {
      return await this.database.transaction(async (transaction) => {
        const session = await this.requireOperationsSession(
          transaction,
          workspaceId,
          validSessionId
        );
        const effectiveSpec = resolveAgentReplacementSpec(session, normalizedSpec);
        const generated = generateSqlErdSchema(effectiveSpec);
        const existingOperation = await this.findOperationByClientOperationId(
          transaction,
          validSessionId,
          currentUserId,
          validAgentRunId
        );
        if (existingOperation) {
          const existing = await this.mapExistingSourcePublish(
            transaction,
            existingOperation,
            requestFingerprint
          );
          return { ...existing, warnings: generated.warnings };
        }

        const currentRevision = Number(session.revision);
        const currentModelFingerprint = createSqlErdModelFingerprint(
          session.model_json
        );
        if (
          currentRevision !== expectedState.revision ||
          currentModelFingerprint !== expectedState.modelFingerprint
        ) {
          throw conflict("sqltoerd session changed; inspect the schema again");
        }

        const activeSourceLock = await this.findActiveSourceLock(
          transaction,
          workspaceId,
          validSessionId
        );
        if (activeSourceLock) {
          throw conflict("sqltoerd source lock is currently held");
        }

        const input: SqlErdSourceSnapshotWriteInput = {
          baseRevision: currentRevision,
          clientOperationId: validAgentRunId,
          dialect: session.dialect,
          modelJson: generated.modelJson,
          sourceFormat: "sql",
          sourceText: generated.sourceText
        };
        const rebased = rebaseSqlErdSourceLayout({
          currentLayout: session.layout_json,
          nextModel: generated.modelJson
        });
        const updatedSession = await this.applySourceSnapshot(
          transaction,
          session,
          currentUserId,
          input,
          rebased.layoutJson
        );
        if (!updatedSession) {
          throw conflict("sqltoerd session revision conflict");
        }

        const snapshot = await this.insertSourceSnapshot(
          transaction,
          updatedSession,
          currentUserId,
          input,
          currentRevision,
          rebased.layoutJson
        );
        if (!snapshot) {
          throw conflict("sqltoerd source snapshot could not be recorded");
        }

        const operation = await this.insertSourceSnapshotOperation(
          transaction,
          updatedSession,
          currentUserId,
          input,
          currentRevision,
          snapshot.id,
          requestFingerprint,
          rebased.summary
        );
        if (!operation) {
          throw conflict("sqltoerd source operation could not be recorded");
        }

        await transaction.execute(
          `
            INSERT INTO sql_erd_session_operation_outbox (operation_id)
            VALUES ($1)
          `,
          [operation.id]
        );

        await this.appendActivities(
          transaction,
          buildSqlErdSessionChangedActivities({
            workspaceId,
            actor: { type: "agent", userId: currentUserId },
            before: session,
            after: updatedSession
          }).filter(({ action }) => action === "sql_erd_schema_updated")
        );

        return {
          ...this.mapOperationWriteResult(updatedSession, operation),
          snapshot: mapSqlErdSourceSnapshot(snapshot),
          rebaseSummary: rebased.summary,
          warnings: generated.warnings
        };
      });
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd generated source snapshot is too large");
      }
      throw error;
    }
  }

  async createPluralSession(
    currentUserId: string,
    workspaceId: string,
    body: CreateSqlErdSessionRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateCreateSqlErdSessionRequest(body);
    return this.createSessionWithWorkspaceLock(
      workspaceId,
      currentUserId,
      input,
      false
    );
  }

  private async createSessionWithWorkspaceLock(
    workspaceId: string,
    currentUserId: string,
    input: NormalizedCreateSqlErdSessionInput,
    requireEmptyWorkspace: boolean
  ): Promise<SqlErdSessionPayload> {
    try {
      const session = await this.database.transaction(async (transaction) => {
        const workspace = await transaction.queryOne<{ id: string }>(
          `
            SELECT id
            FROM workspaces
            WHERE id = $1
            FOR UPDATE
          `,
          [workspaceId]
        );
        if (!workspace) {
          throw notFound("Workspace not found");
        }

        if (requireEmptyWorkspace) {
          const existing = await this.findActiveSession(workspaceId, transaction);
          if (existing) {
            throw conflict("sqltoerd active session already exists");
          }
        }

        const createdSession = await this.insertSession(
          transaction,
          workspaceId,
          currentUserId,
          input
        );
        if (createdSession) {
          await this.appendActivities(
            transaction,
            buildSqlErdSessionCreatedActivities({
              workspaceId,
              actor: { type: "user", userId: currentUserId },
              session: createdSession
            })
          );
        }
        return createdSession;
      });

      if (!session) {
        throw badRequest("sqltoerd session could not be created");
      }

      if (
        resolveNewSqlErdWriteProtocol() === "operations_v1" &&
        session.write_protocol !== "operations_v1"
      ) {
        this.logger.error(
          JSON.stringify({
            event: "SQL_ERD_OPERATIONS_V1_SNAPSHOT_CREATION_DETECTED",
            sessionId: session.id,
            workspaceId,
            writeProtocol: session.write_protocol
          })
        );
      }

      return mapSqlErdSession(session);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw conflict(
          requireEmptyWorkspace
            ? "sqltoerd active session already exists"
            : "sqltoerd multi-session database schema conflict"
        );
      }

      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd JSON payload is too large");
      }

      throw error;
    }
  }

  private insertSession(
    transaction: DatabaseTransaction,
    workspaceId: string,
    currentUserId: string,
    input: NormalizedCreateSqlErdSessionInput
  ): Promise<SqlErdSessionRow | null> {
    return transaction.queryOne<SqlErdSessionRow>(
      `
          INSERT INTO sql_erd_sessions (
            workspace_id,
            title,
            source_format,
            dialect,
            source_text,
            model_json,
            layout_json,
            settings_json,
            table_count,
            relation_count,
            revision,
            write_protocol,
            latest_op_seq,
            created_by,
            updated_by
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6::jsonb,
            $7::jsonb,
            $8::jsonb,
            $9,
            $10,
            1,
            $11,
            $12,
            $13,
            $13
          )
          RETURNING
            id,
            workspace_id,
            title,
            source_format,
            dialect,
            source_text,
            model_json,
            layout_json,
            settings_json,
            table_count,
            relation_count,
            revision,
            write_protocol,
            latest_op_seq,
            created_by,
            updated_by,
            created_at,
            updated_at,
            deleted_at
      `,
      [
        workspaceId,
        input.title,
        input.sourceFormat,
        input.dialect,
        input.sourceText,
        JSON.stringify(input.modelJson),
        JSON.stringify(input.layoutJson),
        JSON.stringify(input.settingsJson),
        input.tableCount,
        input.relationCount,
        resolveNewSqlErdWriteProtocol(),
        0,
        currentUserId
      ]
    );
  }

  async updateSession(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: UpdateSqlErdSessionRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateUpdateSqlErdSessionRequest(body);
    try {
      const session = await this.database.transaction(async (transaction) => {
        const currentSession = await this.findActiveSessionById(
          workspaceId,
          validSessionId,
          transaction,
          true
        );
        if (!currentSession) {
          throw notFound("sqltoerd session not found");
        }
        if (currentSession.write_protocol !== "snapshot") {
          throw sqlErdWriteProtocolMismatch();
        }

        this.assertRevision(currentSession, input.baseRevision);
        if (input.modelJson || input.layoutJson) {
          validateSqlErdLayoutJson(
            input.layoutJson ?? currentSession.layout_json,
            input.modelJson ?? currentSession.model_json
          );
        }

        const updatedSession = await this.updateActiveSession(
          transaction,
          workspaceId,
          validSessionId,
          currentUserId,
          currentSession,
          input
        );
        if (!updatedSession) {
          throw conflict("sqltoerd session revision conflict");
        }

        await this.appendActivities(
          transaction,
          buildSqlErdSessionChangedActivities({
            workspaceId,
            actor: { type: "user", userId: currentUserId },
            before: currentSession,
            after: updatedSession
          })
        );
        return updatedSession;
      });
      return mapSqlErdSession(session);
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd JSON payload is too large");
      }

      throw error;
    }
  }

  async updateSessionMetadata(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: UpdateSqlErdSessionMetadataRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateUpdateSqlErdSessionMetadataRequest(body);

    return this.database.transaction(async (transaction) => {
      const currentSession = await this.findActiveSessionById(
        workspaceId,
        validSessionId,
        transaction,
        true
      );
      if (!currentSession) {
        throw notFound("sqltoerd session not found");
      }

      this.assertRevision(currentSession, input.baseRevision);
      const session = await transaction.queryOne<SqlErdSessionRow>(
        `
          UPDATE sql_erd_sessions
          SET
            title = $3,
            revision = revision + 1,
            updated_by = $4
          WHERE workspace_id = $1
            AND id = $2
            AND deleted_at IS NULL
            AND revision = $5
          RETURNING
            id,
            workspace_id,
            title,
            source_format,
            dialect,
            source_text,
            model_json,
            layout_json,
            settings_json,
            table_count,
            relation_count,
            revision,
            write_protocol,
            latest_op_seq,
            created_by,
            updated_by,
            created_at,
            updated_at,
            deleted_at
        `,
        [workspaceId, validSessionId, input.title, currentUserId, input.baseRevision]
      );
      if (!session) {
        throw conflict("sqltoerd session revision conflict");
      }

      await this.appendActivities(
        transaction,
        buildSqlErdSessionChangedActivities({
          workspaceId,
          actor: { type: "user", userId: currentUserId },
          before: currentSession,
          after: session
        })
      );

      return mapSqlErdSession(session);
    });
  }

  async deleteSession(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    query: DeleteSqlErdSessionQuery
  ): Promise<SqlErdDeletedSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validSessionId = validateSqlErdSessionId(sessionId);
    const input = validateDeleteSqlErdSessionQuery(query);
    return this.database.transaction(async (transaction) => {
      const currentSession = await this.findActiveSessionById(
        workspaceId,
        validSessionId,
        transaction,
        true
      );
      if (!currentSession) {
        throw notFound("sqltoerd session not found");
      }

      this.assertRevision(currentSession, input.baseRevision);
      await transaction.execute(
        `DELETE FROM sql_erd_session_source_locks
         WHERE workspace_id = $1 AND session_id = $2`,
        [workspaceId, validSessionId]
      );
      const session = await transaction.queryOne<SqlErdSessionRow>(
        `
          UPDATE sql_erd_sessions
          SET
            deleted_at = now(),
            revision = revision + 1,
            updated_by = $4
          WHERE workspace_id = $1
            AND id = $2
            AND deleted_at IS NULL
            AND revision = $3
          RETURNING
            id,
            workspace_id,
            title,
            source_format,
            dialect,
            source_text,
            model_json,
            layout_json,
            settings_json,
            table_count,
            relation_count,
            revision,
            write_protocol,
            latest_op_seq,
            created_by,
            updated_by,
            created_at,
            updated_at,
            deleted_at
        `,
        [workspaceId, validSessionId, input.baseRevision, currentUserId]
      );
      if (!session || !session.deleted_at) {
        throw conflict("sqltoerd session revision conflict");
      }

      await this.activityLogService.append(
        transaction,
        buildSqlErdSessionDeletedActivity({
          workspaceId,
          actor: { type: "user", userId: currentUserId },
          session
        })
      );

      return mapDeletedSqlErdSession(
        session.id,
        session.deleted_at,
        session.revision
      );
    });
  }

  private async findOperationByClientOperationId(
    transaction: DatabaseTransaction,
    sessionId: string,
    actorUserId: string,
    clientOperationId: string
  ): Promise<SqlErdOperationRow | null> {
    return transaction.queryOne<SqlErdOperationRow>(
      `
        ${SQL_ERD_OPERATION_SELECT}
        WHERE session_id = $1
          AND actor_user_id = $2
          AND client_operation_id = $3
      `,
      [sessionId, actorUserId, clientOperationId]
    );
  }

  private async requireOperationsSession(
    transaction: DatabaseTransaction,
    workspaceId: string,
    sessionId: string
  ): Promise<SqlErdSessionRow> {
    const session = await this.findActiveSessionById(workspaceId, sessionId, transaction, true);
    if (!session) throw notFound("sqltoerd session not found");
    if (session.write_protocol !== "operations_v1") {
      throw sqlErdWriteProtocolMismatch();
    }
    return session;
  }

  private findActiveSourceLock(
    transaction: DatabaseTransaction,
    workspaceId: string,
    sessionId: string
  ): Promise<SqlErdSourceLockRow | null> {
    return transaction.queryOne<SqlErdSourceLockRow>(
      `
        SELECT workspace_id, session_id, lease_id, actor_user_id, source_base_revision,
          expires_at, created_at, updated_at
        FROM sql_erd_session_source_locks
        WHERE workspace_id = $1 AND session_id = $2 AND expires_at > now()
        FOR UPDATE
      `,
      [workspaceId, sessionId]
    );
  }

  private findOwnedActiveSourceLock(
    transaction: DatabaseTransaction,
    workspaceId: string,
    sessionId: string,
    actorUserId: string,
    leaseId: string
  ): Promise<SqlErdSourceLockRow | null> {
    return transaction.queryOne<SqlErdSourceLockRow>(
      `
        SELECT workspace_id, session_id, lease_id, actor_user_id, source_base_revision,
          expires_at, created_at, updated_at
        FROM sql_erd_session_source_locks
        WHERE workspace_id = $1 AND session_id = $2 AND actor_user_id = $3
          AND lease_id = $4 AND expires_at > now()
        FOR UPDATE
      `,
      [workspaceId, sessionId, actorUserId, leaseId]
    );
  }

  private async assertSourceSnapshotSessionExists(
    workspaceId: string,
    sessionId: string
  ): Promise<void> {
    const session = await this.findActiveSessionById(workspaceId, sessionId);
    if (!session) throw notFound("sqltoerd session not found");
  }

  private async mapExistingSourcePublish(
    transaction: DatabaseTransaction,
    operation: SqlErdOperationRow,
    requestFingerprint: string
  ): Promise<SqlErdSourcePublishPayload> {
    if (
      operation.operation_type !== "source_snapshot" ||
      operation.request_fingerprint !== requestFingerprint ||
      !operation.source_snapshot_id
    ) {
      throw conflict("sqltoerd clientOperationId was reused with different source input");
    }
    const snapshot = await transaction.queryOne<SqlErdSourceSnapshotRow>(
      `${SQL_ERD_SOURCE_SNAPSHOT_SELECT} WHERE id = $1`,
      [operation.source_snapshot_id]
    );
    if (!snapshot) throw conflict("sqltoerd source snapshot is unavailable");
    const summary = readSourceRebaseSummary(operation.payload);
    return {
      operation: mapSqlErdOperation(operation),
      layoutJson: snapshot.layout_json,
      revision: Number(operation.result_revision),
      latestOpSeq: Number(operation.op_seq),
      snapshot: mapSqlErdSourceSnapshot(snapshot),
      rebaseSummary: summary
    };
  }

  private applySourceSnapshot(
    transaction: DatabaseTransaction,
    session: SqlErdSessionRow,
    currentUserId: string,
    input: SqlErdSourceSnapshotWriteInput,
    layoutJson: SqlErdJsonObject
  ): Promise<SqlErdSessionRow | null> {
    return transaction.queryOne<SqlErdSessionRow>(
      `
        UPDATE sql_erd_sessions
        SET
          source_format = $3,
          dialect = $4,
          source_text = $5,
          model_json = $6::jsonb,
          layout_json = $7::jsonb,
          table_count = $8,
          relation_count = $9,
          revision = revision + 1,
          latest_op_seq = latest_op_seq + 1,
          updated_by = $10
        WHERE id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL
          AND write_protocol = 'operations_v1'
          AND revision = $11
        RETURNING
          id, workspace_id, title, source_format, dialect, source_text, model_json, layout_json,
          settings_json, table_count, relation_count, revision, write_protocol, latest_op_seq,
          created_by, updated_by, created_at, updated_at, deleted_at
      `,
      [
        session.id,
        session.workspace_id,
        input.sourceFormat,
        input.dialect,
        input.sourceText,
        JSON.stringify(input.modelJson),
        JSON.stringify(layoutJson),
        countModelTables(input.modelJson),
        countModelRelations(input.modelJson),
        currentUserId,
        Number(session.revision)
      ]
    );
  }

  private insertSourceSnapshot(
    transaction: DatabaseTransaction,
    session: SqlErdSessionRow,
    currentUserId: string,
    input: SqlErdSourceSnapshotWriteInput,
    appliedOnRevision: number,
    layoutJson: SqlErdJsonObject
  ): Promise<SqlErdSourceSnapshotRow | null> {
    return transaction.queryOne<SqlErdSourceSnapshotRow>(
      `
        INSERT INTO sql_erd_session_source_snapshots (
          workspace_id, session_id, source_format, dialect, source_text, model_json, layout_json,
          table_count, relation_count, base_revision, result_revision, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)
        RETURNING id, workspace_id, session_id, source_format, dialect, source_text, model_json,
          layout_json, table_count, relation_count, base_revision, result_revision, created_by, created_at
      `,
      [
        session.workspace_id,
        session.id,
        input.sourceFormat,
        input.dialect,
        input.sourceText,
        JSON.stringify(input.modelJson),
        JSON.stringify(layoutJson),
        Number(session.table_count),
        Number(session.relation_count),
        appliedOnRevision,
        Number(session.revision),
        currentUserId
      ]
    );
  }

  private insertSourceSnapshotOperation(
    transaction: DatabaseTransaction,
    session: SqlErdSessionRow,
    currentUserId: string,
    input: SqlErdSourceSnapshotWriteInput,
    appliedOnRevision: number,
    sourceSnapshotId: string,
    requestFingerprint: string,
    summary: SqlErdSourcePublishPayload["rebaseSummary"]
  ): Promise<SqlErdOperationRow | null> {
    return transaction.queryOne<SqlErdOperationRow>(
      `
        INSERT INTO sql_erd_session_operations (
          workspace_id, session_id, actor_user_id, operation_type, op_seq, client_operation_id,
          base_revision, applied_on_revision, result_revision, payload, source_snapshot_id,
          request_fingerprint
        )
        VALUES ($1, $2, $3, 'source_snapshot', $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
        RETURNING id, workspace_id, session_id, actor_user_id, operation_type, op_seq,
          client_operation_id, base_revision, applied_on_revision, result_revision, payload,
          request_fingerprint, source_snapshot_id, created_at
      `,
      [
        session.workspace_id,
        session.id,
        currentUserId,
        Number(session.latest_op_seq),
        input.clientOperationId,
        input.baseRevision,
        appliedOnRevision,
        Number(session.revision),
        JSON.stringify({ rebaseSummary: summary }),
        sourceSnapshotId,
        requestFingerprint
      ]
    );
  }

  private async applyOperationLayoutPatch(
    transaction: DatabaseTransaction,
    session: SqlErdSessionRow,
    currentUserId: string,
    input: NormalizedSqlErdOperationInput,
    layoutJson: SqlErdSessionRow["layout_json"]
  ): Promise<SqlErdSessionRow | null> {
    return transaction.queryOne<SqlErdSessionRow>(
      `
        UPDATE sql_erd_sessions
        SET
          layout_json = $3::jsonb,
          revision = revision + 1,
          latest_op_seq = latest_op_seq + 1,
          updated_by = $4
        WHERE id = $1
          AND workspace_id = $2
          AND deleted_at IS NULL
          AND write_protocol = 'operations_v1'
          AND revision = $5
        RETURNING
          id,
          workspace_id,
          title,
          source_format,
          dialect,
          source_text,
          model_json,
          layout_json,
          settings_json,
          table_count,
          relation_count,
          revision,
          write_protocol,
          latest_op_seq,
          created_by,
          updated_by,
          created_at,
          updated_at,
          deleted_at
      `,
      [
        session.id,
        session.workspace_id,
        JSON.stringify(layoutJson),
        currentUserId,
        Number(session.revision)
      ]
    );
  }

  private insertOperation(
    transaction: DatabaseTransaction,
    session: SqlErdSessionRow,
    currentUserId: string,
    input: NormalizedSqlErdOperationInput,
    appliedOnRevision: number
  ): Promise<SqlErdOperationRow | null> {
    return transaction.queryOne<SqlErdOperationRow>(
      `
        INSERT INTO sql_erd_session_operations (
          workspace_id,
          session_id,
          actor_user_id,
          operation_type,
          op_seq,
          client_operation_id,
          base_revision,
          applied_on_revision,
          result_revision,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        RETURNING
          id,
          workspace_id,
          session_id,
          actor_user_id,
          operation_type,
          op_seq,
          client_operation_id,
          base_revision,
          applied_on_revision,
          result_revision,
          payload,
          request_fingerprint,
          source_snapshot_id,
          created_at
      `,
      [
        session.workspace_id,
        session.id,
        currentUserId,
        input.type,
        Number(session.latest_op_seq),
        input.clientOperationId,
        input.baseRevision,
        appliedOnRevision,
        Number(session.revision),
        JSON.stringify(input.patch)
      ]
    );
  }

  private mapOperationWriteResult(
    session: SqlErdSessionRow,
    operation: SqlErdOperationRow
  ): SqlErdOperationWritePayload {
    return {
      operation: mapSqlErdOperation(operation),
      layoutJson: session.layout_json,
      revision: Number(session.revision),
      latestOpSeq: Number(session.latest_op_seq)
    };
  }

  private findActiveSession(
    workspaceId: string,
    database: Pick<DatabaseTransaction, "queryOne"> = this.database
  ): Promise<SqlErdSessionRow | null> {
    return database.queryOne<SqlErdSessionRow>(
      `
        ${SQL_ERD_SESSION_SELECT}
        WHERE workspace_id = $1
          AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
      [workspaceId]
    );
  }

  private findActiveSessionById(
    workspaceId: string,
    sessionId: string,
    database: Pick<DatabaseTransaction, "queryOne"> = this.database,
    lock = false
  ): Promise<SqlErdSessionRow | null> {
    return database.queryOne<SqlErdSessionRow>(
      `
        ${SQL_ERD_SESSION_SELECT}
        WHERE workspace_id = $1
          AND id = $2
          AND deleted_at IS NULL
        ${lock ? "FOR UPDATE" : ""}
      `,
      [workspaceId, sessionId]
    );
  }

  private updateActiveSession(
    transaction: DatabaseTransaction,
    workspaceId: string,
    sessionId: string,
    currentUserId: string,
    currentSession: SqlErdSessionRow,
    input: NormalizedUpdateSqlErdSessionInput
  ): Promise<SqlErdSessionRow | null> {
    const modelJson = input.modelJson ?? currentSession.model_json;
    const layoutJson = input.layoutJson ?? currentSession.layout_json;
    const settingsJson = input.settingsJson ?? currentSession.settings_json;
    const tableCount = input.tableCount ?? Number(currentSession.table_count);
    const relationCount =
      input.relationCount ?? Number(currentSession.relation_count);

    return transaction.queryOne<SqlErdSessionRow>(
      `
        UPDATE sql_erd_sessions
        SET
          title = $3,
          source_format = $4,
          dialect = $5,
          source_text = $6,
          model_json = $7::jsonb,
          layout_json = $8::jsonb,
          settings_json = $9::jsonb,
          table_count = $10,
          relation_count = $11,
          revision = revision + 1,
          updated_by = $12
        WHERE workspace_id = $1
          AND id = $2
          AND deleted_at IS NULL
          AND revision = $13
          AND write_protocol = 'snapshot'
        RETURNING
          id,
          workspace_id,
          title,
          source_format,
          dialect,
          source_text,
          model_json,
          layout_json,
          settings_json,
          table_count,
          relation_count,
          revision,
          write_protocol,
          latest_op_seq,
          created_by,
          updated_by,
          created_at,
          updated_at,
          deleted_at
      `,
      [
        workspaceId,
        sessionId,
        input.title ?? currentSession.title,
        input.sourceFormat ?? currentSession.source_format,
        input.dialect ?? currentSession.dialect,
        input.sourceText ?? currentSession.source_text,
        JSON.stringify(modelJson),
        JSON.stringify(layoutJson),
        JSON.stringify(settingsJson),
        tableCount,
        relationCount,
        currentUserId,
        input.baseRevision
      ]
    );
  }

  private assertRevision(
    session: SqlErdSessionRow,
    baseRevision: number
  ): void {
    if (Number(session.revision) !== baseRevision) {
      throw conflict("sqltoerd session revision conflict");
    }
  }

  private async appendActivities(
    transaction: DatabaseTransaction,
    activities: ActivityLogInput[]
  ): Promise<void> {
    for (const activity of activities) {
      await this.activityLogService.append(transaction, activity);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === UNIQUE_VIOLATION_CODE
    );
  }

  private isJsonSizeConstraintViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === CHECK_VIOLATION_CODE &&
      "constraint" in error &&
      typeof error.constraint === "string" &&
      JSON_SIZE_CONSTRAINTS.has(error.constraint)
    );
  }
}

function mapSqlErdSourceLock(lock: SqlErdSourceLockRow): SqlErdSourceLockPayload {
  return {
    leaseId: lock.lease_id,
    sourceBaseRevision: Number(lock.source_base_revision),
    expiresAt: new Date(lock.expires_at).toISOString()
  };
}

function mapSqlErdSourceSnapshot(
  snapshot: SqlErdSourceSnapshotRow
): SqlErdSourceSnapshotPayload {
  return {
    id: snapshot.id,
    sourceFormat: snapshot.source_format,
    dialect: snapshot.dialect,
    sourceText: snapshot.source_text,
    modelJson: snapshot.model_json,
    layoutJson: snapshot.layout_json,
    tableCount: Number(snapshot.table_count),
    relationCount: Number(snapshot.relation_count),
    baseRevision: Number(snapshot.base_revision),
    resultRevision: Number(snapshot.result_revision),
    createdBy: snapshot.created_by,
    createdAt: new Date(snapshot.created_at).toISOString()
  };
}

function createSourcePublishFingerprint(input: SqlErdSourceSnapshotWriteInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        dialect: input.dialect,
        modelJson: input.modelJson,
        sourceFormat: input.sourceFormat,
        sourceText: input.sourceText
      })
    )
    .digest("hex");
}

function createAgentSchemaFingerprint(spec: SqlErdSchemaSpecV1): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

function resolveAgentReplacementSpec(
  session: SqlErdSessionRow,
  spec: SqlErdSchemaSpecV1
): SqlErdSchemaSpecV1 {
  if (
    session.dialect !== "auto" &&
    spec.requestedDialect !== null &&
    spec.requestedDialect !== session.dialect
  ) {
    throw conflict(
      "sqltoerd requested dialect conflicts with the current session dialect"
    );
  }

  return {
    ...spec,
    requestedDialect:
      session.dialect === "auto"
        ? spec.requestedDialect
        : session.dialect
  };
}

function validateAgentRunId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw badRequest("sqltoerd agentRunId is invalid");
  }
  return value;
}

function readSourceRebaseSummary(
  payload: SqlErdJsonObject
): SqlErdSourcePublishPayload["rebaseSummary"] {
  const summary = payload.rebaseSummary;
  if (typeof summary !== "object" || summary === null || Array.isArray(summary)) {
    throw new Error("source_snapshot operation is missing rebaseSummary");
  }
  const candidate = summary as Record<string, unknown>;
  const fields = [
    "createdTableLayoutIds",
    "removedAnnotationLinkIds",
    "removedTableLayoutIds"
  ] as const;
  const parsed = Object.fromEntries(
    fields.map((field) => {
      const value = candidate[field];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error("source_snapshot operation has invalid rebaseSummary");
      }
      return [field, value];
    })
  ) as SqlErdSourcePublishPayload["rebaseSummary"];
  return parsed;
}

function countModelTables(modelJson: SqlErdJsonObject): number {
  return countModelArray(modelJson, "tables");
}

function countModelRelations(modelJson: SqlErdJsonObject): number {
  return countModelArray(modelJson, "relations");
}

function countModelArray(modelJson: SqlErdJsonObject, key: "relations" | "tables"): number {
  const schema = modelJson.schema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return 0;
  const value = (schema as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : 0;
}

export function assertSourceSnapshotBatchResponseSize(
  snapshots: SqlErdSourceSnapshotPayload[]
): void {
  const responseBytes = Buffer.byteLength(
    JSON.stringify({ success: true, data: snapshots }),
    "utf8"
  );
  if (responseBytes > MAX_SQL_ERD_SOURCE_SNAPSHOT_BATCH_RESPONSE_BYTES) {
    throw payloadTooLarge("sqltoerd source snapshot batch response is too large");
  }
}
