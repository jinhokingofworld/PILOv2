import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";

import type { RealtimeDatabase } from "../database/database";

type SessionRow = QueryResultRow & {
  display_name: string;
  user_id: string;
};

export type RealtimeSession = {
  displayName: string;
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
          WITH active_session AS (
            UPDATE user_sessions
            SET last_used_at = now()
            WHERE token_hash = $1
              AND revoked_at IS NULL
              AND expires_at > now()
            RETURNING user_id
          )
          SELECT
            active_session.user_id,
            COALESCE(
              NULLIF(BTRIM(user_settings.display_name), ''),
              NULLIF(BTRIM(users.name), ''),
              NULLIF(BTRIM(users.email), ''),
              'PILO'
            ) AS display_name
          FROM active_session
          JOIN users ON users.id = active_session.user_id
           AND users.deleted_at IS NULL
          LEFT JOIN user_settings ON user_settings.user_id = users.id
        `,
        [hashSessionToken(sessionToken)],
      );

      if (!session) return null;

      return {
        displayName: session.display_name,
        userId: session.user_id,
      };
    },
  };
}
