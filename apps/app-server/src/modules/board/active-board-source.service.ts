import { Injectable } from "@nestjs/common";
import { forbidden, badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GithubProjectV2Service } from "../github-integration/github-project-v2.service";
import { BoardHydrationService } from "./board-hydration.service";
import { BoardSourcePublisherService } from "./board-source-publisher.service";
import type { SetActiveBoardSourceRequest } from "./dto/active-board-source.dto";
import { ActiveBoardSourceQueries, type ActiveBoardSourceRow } from "./queries/active-board-source.queries";
import type { ActiveBoardSourcePayload } from "./types";

@Injectable()
export class ActiveBoardSourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly githubProjectV2Service: GithubProjectV2Service,
    private readonly hydrationService: BoardHydrationService,
    private readonly queries: ActiveBoardSourceQueries,
    private readonly publisher: BoardSourcePublisherService
  ) {}

  async getActiveBoardSource(
    currentUserId: string,
    workspaceId: string
  ): Promise<ActiveBoardSourcePayload | null> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const source = await this.database.transaction((connection) =>
      this.queries.findByWorkspace(connection, workspaceId)
    );
    return source ? this.mapSource(source) : null;
  }

  async setActiveBoardSource(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<ActiveBoardSourcePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertWorkspaceOwner(currentUserId, workspaceId);
    const input = this.normalizeRequest(body);

    const activation = await this.database.transaction(async (connection) => {
      // All transitions acquire the same transaction-scoped lock before hydration,
      // so a slower request cannot overwrite a newer active Board source.
      await this.queries.lockWorkspaceTransition(connection, workspaceId);
      const selected = await this.githubProjectV2Service.selectWorkspaceBoardProjectV2(
        currentUserId,
        workspaceId,
        input,
        connection
      );
      // Hydration is inside the transition boundary. A failure rolls back selection,
      // schedules, and the source pointer together.
      const hydrated = await this.hydrationService.createBoard(currentUserId, workspaceId, input);
      const result = await this.queries.upsert(
        connection,
        workspaceId,
        hydrated.board.id,
        currentUserId
      );
      if (!result) throw notFound("Active Board source not found");
      return { selected, source: result };
    });
    const payload = this.mapSource(activation.source);

    // Queue detail refresh only after the committed source is available. Existing
    // sync invalidations hydrate the active Board again when this background work ends.
    try {
      await this.githubProjectV2Service.enqueueWorkspaceBoardProjectV2Sync(
        currentUserId,
        workspaceId,
        activation.selected
      );
    } catch (error) {
      console.error("Board source ProjectV2 detail sync enqueue failed", error);
    }

    try {
      await this.publisher.publishSourceUpdated({
        workspaceId: payload.workspaceId,
        boardId: payload.boardId,
        changedAt: payload.updatedAt
      });
    } catch (error) {
      console.error("Board source update publish failed", error);
    }

    return payload;
  }

  private async assertWorkspaceOwner(currentUserId: string, workspaceId: string) {
    const workspace = await this.database.queryOne<{ owner_user_id: string | null }>(
      "SELECT owner_user_id FROM workspaces WHERE id = $1::uuid",
      [workspaceId]
    );
    if (!workspace) throw notFound("Workspace not found");
    if (workspace.owner_user_id !== currentUserId) {
      throw forbidden("Only the workspace owner can change the active Board source");
    }
  }

  private normalizeRequest(body: unknown): { repositoryId: string; projectV2Id: string } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }
    const request = body as SetActiveBoardSourceRequest;
    return {
      repositoryId: this.requiredString(request.repositoryId, "repositoryId"),
      projectV2Id: this.requiredString(request.projectV2Id, "projectV2Id")
    };
  }

  private requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw badRequest(`${name} is required`);
    return value.trim();
  }

  private mapSource(row: ActiveBoardSourceRow): ActiveBoardSourcePayload {
    const projectNumber = Number(row.project_number);
    if (!Number.isSafeInteger(projectNumber)) throw badRequest("Invalid GitHub ProjectV2 number");
    return {
      boardId: String(row.board_id),
      workspaceId: row.workspace_id,
      repository: { id: row.repository_id, fullName: row.repository_full_name, htmlUrl: row.repository_html_url },
      project: {
        id: row.project_v2_id,
        githubProjectNodeId: row.github_project_node_id,
        projectNumber,
        title: row.project_title,
        url: row.project_url
      },
      updatedByUserId: row.updated_by_user_id,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString()
    };
  }
}
