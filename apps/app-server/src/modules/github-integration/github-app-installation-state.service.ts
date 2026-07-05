import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import type { GithubAppRuntimeConfig } from "./github-integration-config.service";

export interface GithubAppInstallationStateInput {
  userId: string;
  workspaceId: string;
  returnUrl: string | null;
}

export interface GithubAppInstallationStatePayload
  extends GithubAppInstallationStateInput {
  nonce: string;
  expiresAt: number;
}

interface SerializedGithubAppInstallationState
  extends GithubAppInstallationStatePayload {
  version: 1;
}

@Injectable()
export class GithubAppInstallationStateService {
  createState(
    input: GithubAppInstallationStateInput,
    config: GithubAppRuntimeConfig
  ): string {
    const now = this.getNow(config).getTime();
    const payload: SerializedGithubAppInstallationState = {
      version: 1,
      userId: input.userId,
      workspaceId: input.workspaceId,
      returnUrl: input.returnUrl,
      nonce: randomBytes(16).toString("base64url"),
      expiresAt: now + config.stateTtlSeconds * 1000
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url"
    );
    const signature = this.sign(encodedPayload, config.stateSecret);

    return `${encodedPayload}.${signature}`;
  }

  verifyState(
    state: string,
    config: GithubAppRuntimeConfig
  ): GithubAppInstallationStatePayload {
    const [encodedPayload, signature, ...rest] = state.split(".");
    if (!encodedPayload || !signature || rest.length > 0) {
      throw badRequest("Invalid GitHub App installation state");
    }

    const expectedSignature = this.sign(encodedPayload, config.stateSecret);
    if (!this.constantTimeEqual(signature, expectedSignature)) {
      throw badRequest("Invalid GitHub App installation state");
    }

    const payload = this.parsePayload(encodedPayload);
    if (payload.expiresAt <= this.getNow(config).getTime()) {
      throw badRequest("Invalid GitHub App installation state");
    }

    return {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      returnUrl: payload.returnUrl,
      nonce: payload.nonce,
      expiresAt: payload.expiresAt
    };
  }

  private parsePayload(encodedPayload: string): SerializedGithubAppInstallationState {
    try {
      const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
      const value = JSON.parse(
        decoded
      ) as Partial<SerializedGithubAppInstallationState>;

      if (
        value.version !== 1 ||
        typeof value.userId !== "string" ||
        !value.userId ||
        typeof value.workspaceId !== "string" ||
        !value.workspaceId ||
        typeof value.nonce !== "string" ||
        !value.nonce ||
        typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt) ||
        (value.returnUrl !== null && typeof value.returnUrl !== "string")
      ) {
        throw new Error("Invalid payload");
      }

      return {
        version: 1,
        userId: value.userId,
        workspaceId: value.workspaceId,
        returnUrl: value.returnUrl,
        nonce: value.nonce,
        expiresAt: value.expiresAt
      };
    } catch {
      throw badRequest("Invalid GitHub App installation state");
    }
  }

  private sign(encodedPayload: string, secret: string): string {
    return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
  }

  private constantTimeEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private getNow(config: GithubAppRuntimeConfig): Date {
    return config.now ? config.now() : new Date();
  }
}
