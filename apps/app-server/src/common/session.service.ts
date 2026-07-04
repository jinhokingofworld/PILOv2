import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { unauthorized } from "./api-error";
import { DatabaseService } from "../database/database.service";

interface SessionRow extends QueryResultRow {
  user_id: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly database: DatabaseService) {}

  async validateSessionToken(sessionToken: string): Promise<string> {
    if (!sessionToken) {
      throw unauthorized("Missing bearer token");
    }

    const tokenHash = this.hashSessionToken(sessionToken);
    const session = await this.database.queryOne<SessionRow>(
      `
        UPDATE user_sessions
        SET last_used_at = now()
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
        RETURNING user_id
      `,
      [tokenHash]
    );

    if (!session) {
      throw unauthorized("Invalid or expired session");
    }

    return session.user_id;
  }

  hashSessionToken(sessionToken: string): string {
    return createHash("sha256").update(sessionToken, "utf8").digest("hex");
  }
}
