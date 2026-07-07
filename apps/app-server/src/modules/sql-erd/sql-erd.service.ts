import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  CreateSqlErdSessionRequest,
  DeleteSqlErdSessionQuery,
  SqlErdDeletedSessionPayload,
  SqlErdSessionPayload,
  UpdateSqlErdSessionRequest
} from "./sql-erd.types";

@Injectable()
export class SqlErdService {
  constructor(private readonly workspaceService: WorkspaceService) {}

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

    return null;
  }

  async createSession(
    currentUserId: string,
    workspaceId: string,
    body: CreateSqlErdSessionRequest
  ): Promise<SqlErdSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    void body;

    return this.throwNotImplemented("create");
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
}
