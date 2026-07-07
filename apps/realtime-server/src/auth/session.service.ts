import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";

import type { RealtimeDatabase } from "../database/database";

type SessionRow = QueryResultRow & {
  user_id: string;
};

export type RealtimeSession = {
  userId: string;
};

export type RealtimeSessionService = {
  validateSessionToken: (sessionToken: string) => Promise<RealtimeSession | null>;
};

export function hashSessionToken(sessionToken: string) {
  return createHash("sha256").update(sessionToken, "utf8").digest("hex");
}

export function createRealtimeSessionService(
  database: RealtimeDatabase,
): RealtimeSessionService {
  return {
    async validateSessionToken(sessionToken) {
      if (!sessionToken) return null;

      const session = await database.queryOne<SessionRow>(
        `
          UPDATE user_sessions
          SET last_used_at = now()
          WHERE token_hash = $1
            AND revoked_at IS NULL
            AND expires_at > now()
          RETURNING user_id
        `,
        [hashSessionToken(sessionToken)],
      );

      if (!session) return null;

      return {
        userId: session.user_id,
      };
    },
  };
}
