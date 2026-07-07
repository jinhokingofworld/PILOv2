import { Injectable } from "@nestjs/common";
import { badRequest, conflict } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { mapSqlErdSession } from "./sql-erd.mapper";
import {
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  SqlErdDeletedSessionPayload,
  SqlErdSessionPayload,
  SqlErdSessionRow,
  UpdateSqlErdSessionRequest
} from "./sql-erd.types";
import { validateCreateSqlErdSessionRequest } from "./sql-erd.validation";

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
    created_by,
    updated_by,
    created_at,
    updated_at,
    deleted_at
  FROM sql_erd_sessions
`;
const UNIQUE_VIOLATION_CODE = "23505";

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

  async createSession(
    currentUserId: string,
    workspaceId: string,
    body: CreateSqlErdSessionRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateCreateSqlErdSessionRequest(body);
    const existing = await this.findActiveSession(workspaceId);
    if (existing) {
      throw conflict("sqltoerd active session already exists");
    }

    try {
      const session = await this.database.queryOne<SqlErdSessionRow>(
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

      if (!session) {
        throw badRequest("sqltoerd session could not be created");
      }

      return mapSqlErdSession(session);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw conflict("sqltoerd active session already exists");
      }

      throw error;
    }
  }

  async updateSession(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    body: UpdateSqlErdSessionRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    void sessionId;
    void body;

    return this.throwNotImplemented("update");
  }

  async deleteSession(
    currentUserId: string,
    workspaceId: string,
    sessionId: string,
    query: DeleteSqlErdSessionQuery
  ): Promise<SqlErdDeletedSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    void sessionId;
    void query;

    return this.throwNotImplemented("delete");
  }

  private throwNotImplemented(action: string): never {
    throw badRequest(`sqltoerd session ${action} is not implemented`);
  }

  private findActiveSession(workspaceId: string): Promise<SqlErdSessionRow | null> {
    return this.database.queryOne<SqlErdSessionRow>(
      `
        ${SQL_ERD_SESSION_SELECT}
        WHERE workspace_id = $1
          AND deleted_at IS NULL
      `,
      [workspaceId]
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === UNIQUE_VIOLATION_CODE
    );
  }
}
