import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, forbidden } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

export type SettingsTheme = "system" | "light" | "dark";
export type SettingsDensity = "comfortable" | "compact";
export type SettingsLandingPage = "home" | "calendar" | "board" | "canvas";

interface SettingsRow extends QueryResultRow {
  theme: SettingsTheme;
  density: SettingsDensity;
  default_workspace_id: string | null;
  default_landing_page: SettingsLandingPage;
  restore_last_workspace: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MembershipRow extends QueryResultRow {
  id: string;
}

export interface SettingsPayload {
  theme: SettingsTheme;
  density: SettingsDensity;
  defaultWorkspaceId: string | null;
  defaultLandingPage: SettingsLandingPage;
  restoreLastWorkspace: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpdateSettingsRequest {
  theme?: unknown;
  density?: unknown;
  defaultWorkspaceId?: unknown;
  defaultLandingPage?: unknown;
  restoreLastWorkspace?: unknown;
}

const DEFAULT_SETTINGS: SettingsPayload = {
  theme: "system",
  density: "comfortable",
  defaultWorkspaceId: null,
  defaultLandingPage: "home",
  restoreLastWorkspace: true,
  createdAt: null,
  updatedAt: null
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_FIELDS = new Set([
  "theme",
  "density",
  "defaultWorkspaceId",
  "defaultLandingPage",
  "restoreLastWorkspace"
]);

@Injectable()
export class SettingsService {
  constructor(private readonly database: DatabaseService) {}

  async getSettings(currentUserId: string): Promise<SettingsPayload> {
    const row = await this.database.queryOne<SettingsRow>(
      `
        SELECT
          theme,
          density,
          default_workspace_id,
          default_landing_page,
          restore_last_workspace,
          created_at,
          updated_at
        FROM user_settings
        WHERE user_id = $1
      `,
      [currentUserId]
    );

    if (!row) {
      return { ...DEFAULT_SETTINGS };
    }

    if (
      row.default_workspace_id &&
      !(await this.hasWorkspaceAccess(currentUserId, row.default_workspace_id))
    ) {
      await this.database.execute(
        `UPDATE user_settings SET default_workspace_id = NULL WHERE user_id = $1`,
        [currentUserId]
      );
      row.default_workspace_id = null;
    }

    return this.mapSettings(row);
  }

  async updateSettings(
    currentUserId: string,
    request: UpdateSettingsRequest | undefined
  ): Promise<SettingsPayload> {
    const input = this.readRequest(request);
    const current = await this.getSettings(currentUserId);
    const next = {
      theme:
        "theme" in input ? this.readTheme(input.theme) : current.theme,
      density:
        "density" in input ? this.readDensity(input.density) : current.density,
      defaultWorkspaceId:
        "defaultWorkspaceId" in input
          ? this.readDefaultWorkspaceId(input.defaultWorkspaceId)
          : current.defaultWorkspaceId,
      defaultLandingPage:
        "defaultLandingPage" in input
          ? this.readLandingPage(input.defaultLandingPage)
          : current.defaultLandingPage,
      restoreLastWorkspace:
        "restoreLastWorkspace" in input
          ? this.readBoolean(input.restoreLastWorkspace, "restoreLastWorkspace")
          : current.restoreLastWorkspace
    };

    if (
      next.defaultWorkspaceId &&
      !(await this.hasWorkspaceAccess(currentUserId, next.defaultWorkspaceId))
    ) {
      throw forbidden("Default Workspace access denied");
    }

    const row = await this.database.queryOne<SettingsRow>(
      `
        INSERT INTO user_settings (
          user_id,
          theme,
          density,
          default_workspace_id,
          default_landing_page,
          restore_last_workspace
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE
        SET
          theme = EXCLUDED.theme,
          density = EXCLUDED.density,
          default_workspace_id = EXCLUDED.default_workspace_id,
          default_landing_page = EXCLUDED.default_landing_page,
          restore_last_workspace = EXCLUDED.restore_last_workspace
        RETURNING
          theme,
          density,
          default_workspace_id,
          default_landing_page,
          restore_last_workspace,
          created_at,
          updated_at
      `,
      [
        currentUserId,
        next.theme,
        next.density,
        next.defaultWorkspaceId,
        next.defaultLandingPage,
        next.restoreLastWorkspace
      ]
    );

    if (!row) {
      throw new Error("Settings could not be saved");
    }

    return this.mapSettings(row);
  }

  private readRequest(
    request: UpdateSettingsRequest | undefined
  ): Record<string, unknown> {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw badRequest("Settings request body is required");
    }

    const input = request as Record<string, unknown>;
    const keys = Object.keys(input);
    if (keys.length === 0) {
      throw badRequest("At least one settings field is required");
    }
    if (keys.some((key) => !SUPPORTED_FIELDS.has(key))) {
      throw badRequest("Unsupported settings field");
    }
    return input;
  }

  private readTheme(value: unknown): SettingsTheme {
    if (value === "system" || value === "light" || value === "dark") {
      return value;
    }
    throw badRequest("theme must be system, light, or dark");
  }

  private readDensity(value: unknown): SettingsDensity {
    if (value === "comfortable" || value === "compact") {
      return value;
    }
    throw badRequest("density must be comfortable or compact");
  }

  private readLandingPage(value: unknown): SettingsLandingPage {
    if (
      value === "home" ||
      value === "calendar" ||
      value === "board" ||
      value === "canvas"
    ) {
      return value;
    }
    throw badRequest("defaultLandingPage is invalid");
  }

  private readDefaultWorkspaceId(value: unknown): string | null {
    if (value === null) {
      return null;
    }
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest("defaultWorkspaceId must be a Workspace UUID or null");
    }
    return value;
  }

  private readBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") {
      throw badRequest(`${field} must be a boolean`);
    }
    return value;
  }

  private async hasWorkspaceAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<boolean> {
    const membership = await this.database.queryOne<MembershipRow>(
      `
        SELECT id
        FROM workspace_members
        WHERE user_id = $1 AND workspace_id = $2
      `,
      [currentUserId, workspaceId]
    );
    return Boolean(membership);
  }

  private mapSettings(row: SettingsRow): SettingsPayload {
    return {
      theme: row.theme,
      density: row.density,
      defaultWorkspaceId: row.default_workspace_id,
      defaultLandingPage: row.default_landing_page,
      restoreLastWorkspace: row.restore_last_workspace,
      createdAt: this.toIsoString(row.created_at),
      updatedAt: this.toIsoString(row.updated_at)
    };
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
