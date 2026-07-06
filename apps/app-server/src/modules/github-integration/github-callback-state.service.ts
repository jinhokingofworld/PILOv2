import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";

export type GithubCallbackStateFlow = "oauth" | "app_installation";

export interface GithubCallbackStateRuntimeConfig {
  apiPublicOrigin: string;
  apiBasePath: string;
  stateTtlSeconds: number;
}

export interface StoreGithubCallbackStateInput {
  flow: GithubCallbackStateFlow;
  stateNonce: string;
  userId: string;
  workspaceId: string | null;
  returnUrl: string | null;
  bindingTokenHash: string;
  expiresAt: Date;
}

export interface ConsumeGithubCallbackStateInput {
  flow: GithubCallbackStateFlow;
  stateNonce: string;
  cookieHeader: string | null | undefined;
}

export interface GithubCallbackStatePayload {
  userId: string;
  workspaceId: string | null;
  returnUrl: string | null;
  expiresAt: Date | string;
}

interface GithubCallbackStateRow extends QueryResultRow {
  user_id: string;
  workspace_id: string | null;
  return_url: string | null;
  expires_at: Date | string;
}

const COOKIE_NAMES: Record<GithubCallbackStateFlow, string> = {
  oauth: "pilo_github_oauth_state",
  app_installation: "pilo_github_app_installation_state"
};

@Injectable()
export class GithubCallbackStateService {
  constructor(private readonly database: DatabaseService) {}

  createBindingToken(): string {
    return randomBytes(32).toString("base64url");
  }

  hashBindingToken(bindingToken: string): string {
    return createHash("sha256").update(bindingToken, "utf8").digest("hex");
  }

  buildSetCookieHeader(
    flow: GithubCallbackStateFlow,
    bindingToken: string,
    config: GithubCallbackStateRuntimeConfig
  ): string {
    const parts = [
      `${COOKIE_NAMES[flow]}=${encodeURIComponent(bindingToken)}`,
      `Max-Age=${config.stateTtlSeconds}`,
      `Path=${this.getCookiePath(config)}`,
      "HttpOnly",
      "SameSite=Lax"
    ];

    if (this.isSecureOrigin(config.apiPublicOrigin)) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  async storeState(input: StoreGithubCallbackStateInput): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO github_callback_states (
          flow,
          state_nonce,
          user_id,
          workspace_id,
          return_url,
          binding_token_hash,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.flow,
        input.stateNonce,
        input.userId,
        input.workspaceId,
        input.returnUrl,
        input.bindingTokenHash,
        input.expiresAt
      ]
    );
  }

  async consumeState(
    input: ConsumeGithubCallbackStateInput
  ): Promise<GithubCallbackStatePayload> {
    const bindingToken = this.readBindingToken(input.flow, input.cookieHeader);
    if (!bindingToken) {
      throw badRequest(this.getInvalidStateMessage(input.flow));
    }

    const row = await this.database.queryOne<GithubCallbackStateRow>(
      `
        UPDATE github_callback_states
        SET consumed_at = now()
        WHERE flow = $1
          AND state_nonce = $2
          AND binding_token_hash = $3
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING
          user_id,
          workspace_id,
          return_url,
          expires_at
      `,
      [
        input.flow,
        input.stateNonce,
        this.hashBindingToken(bindingToken)
      ]
    );

    if (!row) {
      throw badRequest(this.getInvalidStateMessage(input.flow));
    }

    return {
      userId: row.user_id,
      workspaceId: row.workspace_id,
      returnUrl: row.return_url,
      expiresAt: row.expires_at
    };
  }

  private readBindingToken(
    flow: GithubCallbackStateFlow,
    cookieHeader: string | null | undefined
  ): string | null {
    if (!cookieHeader) {
      return null;
    }

    const cookieName = COOKIE_NAMES[flow];
    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
      const [rawName, ...rawValueParts] = cookie.trim().split("=");
      if (rawName !== cookieName) {
        continue;
      }

      const rawValue = rawValueParts.join("=");
      if (!rawValue) {
        return null;
      }

      try {
        return decodeURIComponent(rawValue);
      } catch {
        return null;
      }
    }

    return null;
  }

  private getInvalidStateMessage(flow: GithubCallbackStateFlow): string {
    return flow === "oauth"
      ? "Invalid OAuth state"
      : "Invalid GitHub App installation state";
  }

  private getCookiePath(config: GithubCallbackStateRuntimeConfig): string {
    const apiBasePath = config.apiBasePath.replace(/\/+$/, "");
    return `${apiBasePath || ""}/github`;
  }

  private isSecureOrigin(apiPublicOrigin: string): boolean {
    try {
      return new URL(apiPublicOrigin).protocol === "https:";
    } catch {
      return false;
    }
  }
}
