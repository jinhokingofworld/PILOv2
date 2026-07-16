import type { RealtimeDatabase } from "../database/database";

export type ChatAccessContext = {
  userId?: string;
};

export function createChatAccessService(database: RealtimeDatabase) {
  return {
    async canJoinWorkspace(context: ChatAccessContext, workspaceId: string) {
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
