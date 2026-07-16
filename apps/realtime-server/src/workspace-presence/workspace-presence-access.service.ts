import type { RealtimeDatabase } from "../database/database";

export type WorkspacePresenceAccessContext = {
  userId?: string;
};

export function createWorkspacePresenceAccessService(
  database: RealtimeDatabase,
) {
  return {
    async canJoinWorkspace(
      context: WorkspacePresenceAccessContext,
      workspaceId: string,
    ) {
      if (!context.userId || !workspaceId) return false;

      const membership = await database.queryOne<{ id: string }>(
        `SELECT id
         FROM workspace_members
         WHERE workspace_id = $1
           AND user_id = $2
         LIMIT 1`,
        [workspaceId, context.userId],
      );

      return Boolean(membership);
    },
  };
}
