import type { RealtimeDatabase } from "../database/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GithubSourceAccessContext = {
  userId: string;
};

export function createGithubSourceAccessService(database?: RealtimeDatabase) {
  return {
    async canJoinWorkspace(
      context: GithubSourceAccessContext,
      workspaceId: string
    ): Promise<boolean> {
      if (
        !UUID_PATTERN.test(context.userId) ||
        !UUID_PATTERN.test(workspaceId)
      ) {
        return false;
      }
      if (!database) {
        return true;
      }
      return Boolean(
        await database.queryOne(
          `SELECT workspace_id FROM workspace_members
           WHERE workspace_id=$1::uuid AND user_id=$2::uuid LIMIT 1`,
          [workspaceId, context.userId]
        )
      );
    }
  };
}
