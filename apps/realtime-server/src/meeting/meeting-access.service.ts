import type { RealtimeDatabase } from "../database/database";

export type MeetingAccessContext = {
  userId: string;
};

export function createMeetingAccessService(database: RealtimeDatabase) {
  return {
    async canJoinWorkspace(context: MeetingAccessContext, workspaceId: string) {
      if (!context.userId || !workspaceId) return false;

      const membership = await database.queryOne<{ id: string }>(
        `SELECT id
         FROM workspace_members
         WHERE workspace_id = $1
           AND user_id = $2
         LIMIT 1`,
        [workspaceId, context.userId]
      );

      return Boolean(membership);
    }
  };
}
