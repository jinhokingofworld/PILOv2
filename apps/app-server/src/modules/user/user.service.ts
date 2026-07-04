import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { unauthorized } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

interface UserRow extends QueryResultRow {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class UserService {
  constructor(private readonly database: DatabaseService) {}

  async getCurrentUser(currentUserId: string): Promise<UserProfile> {
    const user = await this.database.queryOne<UserRow>(
      `
        SELECT id, name, email, avatar_url, created_at, updated_at
        FROM users
        WHERE id = $1
      `,
      [currentUserId]
    );

    if (!user) {
      throw unauthorized("Current user not found");
    }

    return this.mapUser(user);
  }

  private mapUser(user: UserRow): UserProfile {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      createdAt: this.toIsoString(user.created_at),
      updatedAt: this.toIsoString(user.updated_at)
    };
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
