import { createSign } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import { GITHUB_API_VERSION } from "./github-api.constants";

export interface GithubAppInstallationLookupRequest {
  installationId: number;
  appId: string;
  privateKey: string;
  now?: () => Date;
}

export interface GithubAppInstallationDetails {
  githubInstallationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: string | null;
  permissions: Record<string, unknown>;
  installedAt: string | null;
  suspendedAt: string | null;
}

interface GithubInstallationApiPayload {
  id: number;
  account?: {
    login?: string;
    type?: string;
  } | null;
  repository_selection?: string | null;
  permissions?: unknown;
  created_at?: string | null;
  suspended_at?: string | null;
}

@Injectable()
export class GithubAppClient {
  async getInstallation(
    input: GithubAppInstallationLookupRequest
  ): Promise<GithubAppInstallationDetails> {
    const appJwt = this.createAppJwt(input);
    let response: Response;
    try {
      response = await fetch(
        `https://api.github.com/app/installations/${input.installationId}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${appJwt}`,
            "X-GitHub-Api-Version": GITHUB_API_VERSION
          }
        }
      );
    } catch {
      throw badRequest("GitHub App installation lookup failed");
    }

    if (!response.ok) {
      throw badRequest("GitHub App installation lookup failed");
    }

    const payload = await this.readJson(response);
    if (!this.isInstallationPayload(payload)) {
      throw badRequest("GitHub App installation lookup failed");
    }

    return {
      githubInstallationId: payload.id,
      accountLogin: payload.account.login,
      accountType: payload.account.type,
      repositorySelection: payload.repository_selection ?? null,
      permissions: this.toObject(payload.permissions),
      installedAt: payload.created_at ?? null,
      suspendedAt: payload.suspended_at ?? null
    };
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw badRequest("GitHub App installation lookup failed");
    }
  }

  private createAppJwt(input: GithubAppInstallationLookupRequest): string {
    try {
      const nowSeconds = Math.floor(
        (input.now ? input.now() : new Date()).getTime() / 1000
      );
      const header = this.encodeJson({
        alg: "RS256",
        typ: "JWT"
      });
      const payload = this.encodeJson({
        iat: nowSeconds - 60,
        exp: nowSeconds + 540,
        iss: input.appId
      });
      const body = `${header}.${payload}`;
      const signature = createSign("RSA-SHA256")
        .update(body)
        .end()
        .sign(input.privateKey, "base64url");

      return `${body}.${signature}`;
    } catch {
      throw badRequest("GitHub App is not configured");
    }
  }

  private encodeJson(value: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  private isInstallationPayload(value: unknown): value is GithubInstallationApiPayload & {
    account: { login: string; type: "User" | "Organization" };
  } {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const payload = value as GithubInstallationApiPayload;
    return (
      typeof payload.id === "number" &&
      typeof payload.account?.login === "string" &&
      payload.account.login.length > 0 &&
      (payload.account.type === "User" || payload.account.type === "Organization")
    );
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
