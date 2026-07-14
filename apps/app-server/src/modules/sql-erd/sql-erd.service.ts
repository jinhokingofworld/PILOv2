import { Injectable } from "@nestjs/common";
import {
  badRequest,
  conflict,
  notFound,
  payloadTooLarge,
  sqlErdWriteProtocolMismatch
} from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { encodeSqlErdSessionCursor } from "./sql-erd.cursor";
import {
  mapDeletedSqlErdSession,
  mapSqlErdSession,
  mapSqlErdSessionSummary
} from "./sql-erd.mapper";
import { applySqlErdLayoutPatch } from "./sql-erd-layout-patch";
import { mapSqlErdOperation } from "./sql-erd-operation.mapper";
import {
  validateCreateSqlErdOperationRequest,
  validateListSqlErdOperationsQuery
} from "./sql-erd-operation.validation";
import {
  CreateSqlErdOperationRequest,
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  ListSqlErdOperationsQuery,
  ListSqlErdSessionsQuery,
  NormalizedCreateSqlErdSessionInput,
  NormalizedSqlErdOperationInput,
  NormalizedUpdateSqlErdSessionInput,
  SqlErdDeletedSessionPayload,
  SqlErdOperationListPayload,
  SqlErdOperationRow,
  SqlErdOperationWritePayload,
  SqlErdSessionListPayload,
  SqlErdSessionPayload,
  SqlErdSessionRow,
  SqlErdSessionSummaryRow,
  UpdateSqlErdSessionRequest
} from "./sql-erd.types";
import {
  validateCreateSqlErdSessionRequest,
  validateDeleteSqlErdSessionQuery,
  validateListSqlErdSessionsQuery,
  validateSqlErdLayoutJson,
  validateSqlErdSessionId,
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
  "sql_erd_sessions_settings_json_size_check"
]);
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
    created_at
  FROM sql_erd_session_operations
`;

@Injectable()
export class SqlErdService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
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
    const session = await this.findActiveSessionById(workspaceId, validSessionId);
    if (!session) {
      throw notFound("sqltoerd session not found");
    }

    const rows = await this.database.query<SqlErdOperationRow>(
      `
        ${SQL_ERD_OPERATION_SELECT}
        WHERE workspace_id = $1
          AND session_id = $2
          AND op_seq > $3
        ORDER BY op_seq ASC
        LIMIT $4
      `,
      [workspaceId, validSessionId, input.afterSeq, input.limit + 1]
    );
    const hasNextPage = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const lastRow = pageRows.at(-1);

    return {
      items: pageRows.map(mapSqlErdOperation),
      latestOpSeq: Number(session.latest_op_seq),
      nextAfterSeq:
        hasNextPage && lastRow ? Number(lastRow.op_seq) : null
    };
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

        return this.mapOperationWriteResult(updatedSession, operation);
      });
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd JSON payload is too large");
      }
      throw error;
    }
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

        return this.insertSession(
          transaction,
          workspaceId,
          currentUserId,
          input
        );
      });

      if (!session) {
        throw badRequest("sqltoerd session could not be created");
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
            $11
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
    const currentSession = await this.findActiveSessionById(
      workspaceId,
      validSessionId
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

    let session: SqlErdSessionRow | null;
    try {
      session = await this.updateActiveSession(
        workspaceId,
        validSessionId,
        currentUserId,
        currentSession,
        input
      );
    } catch (error) {
      if (this.isJsonSizeConstraintViolation(error)) {
        throw payloadTooLarge("sqltoerd JSON payload is too large");
      }

      throw error;
    }

    if (!session) {
      return await this.throwMissingOrConflict(workspaceId, validSessionId);
    }

    return mapSqlErdSession(session);
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
    const session = await this.database.queryOne<SqlErdSessionRow>(
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

    if (!session) {
      return await this.throwMissingOrConflict(workspaceId, validSessionId);
    }

    if (!session.deleted_at) {
      return await this.throwMissingOrConflict(workspaceId, validSessionId);
    }

    return mapDeletedSqlErdSession(
      session.id,
      session.deleted_at,
      session.revision
    );
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

    return this.database.queryOne<SqlErdSessionRow>(
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

  private async throwMissingOrConflict(
    workspaceId: string,
    sessionId: string
  ): Promise<never> {
    const currentSession = await this.findActiveSessionById(workspaceId, sessionId);
    if (currentSession) {
      if (currentSession.write_protocol !== "snapshot") {
        throw sqlErdWriteProtocolMismatch();
      }
      throw conflict("sqltoerd session revision conflict");
    }

    throw notFound("sqltoerd session not found");
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
