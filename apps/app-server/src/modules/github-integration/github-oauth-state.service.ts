import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import type { GithubOAuthRuntimeConfig } from "./github-integration-config.service";

export interface GithubOAuthStateInput {
  userId: string;
  returnUrl: string | null;
  expectedConnectionGeneration?: string;
}

export interface GithubOAuthStatePayload extends GithubOAuthStateInput {
  nonce: string;
  expiresAt: number;
}

interface SerializedGithubOAuthState extends GithubOAuthStatePayload {
  version: 1;
}

@Injectable()
export class GithubOAuthStateService {
  createState(input: GithubOAuthStateInput, config: GithubOAuthRuntimeConfig): string {
    const now = this.getNow(config).getTime();
    const payload: SerializedGithubOAuthState = {
      version: 1,
      userId: input.userId,
      returnUrl: input.returnUrl,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      nonce: randomBytes(16).toString("base64url"),
      expiresAt: now + config.stateTtlSeconds * 1000
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url"
    );
    const signature = this.sign(encodedPayload, config.stateSecret);

    return `${encodedPayload}.${signature}`;
  }

  verifyState(state: string, config: GithubOAuthRuntimeConfig): GithubOAuthStatePayload {
    const [encodedPayload, signature, ...rest] = state.split(".");
    if (!encodedPayload || !signature || rest.length > 0) {
      throw badRequest("Invalid OAuth state");
    }

    const expectedSignature = this.sign(encodedPayload, config.stateSecret);
    if (!this.constantTimeEqual(signature, expectedSignature)) {
      throw badRequest("Invalid OAuth state");
    }

    const payload = this.parsePayload(encodedPayload);
    if (payload.expiresAt <= this.getNow(config).getTime()) {
      throw badRequest("Invalid OAuth state");
    }

    return {
      userId: payload.userId,
      returnUrl: payload.returnUrl,
      expectedConnectionGeneration: payload.expectedConnectionGeneration,
      nonce: payload.nonce,
      expiresAt: payload.expiresAt
    };
  }

  private parsePayload(encodedPayload: string): SerializedGithubOAuthState {
    try {
      const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
      const value = JSON.parse(decoded) as Partial<SerializedGithubOAuthState>;

      if (
        value.version !== 1 ||
        typeof value.userId !== "string" ||
        !value.userId ||
        typeof value.nonce !== "string" ||
        !value.nonce ||
        typeof value.expiresAt !== "number" ||
        !Number.isFinite(value.expiresAt) ||
        (value.returnUrl !== null && typeof value.returnUrl !== "string")
        || (value.expectedConnectionGeneration !== undefined && typeof value.expectedConnectionGeneration !== "string")
      ) {
        throw new Error("Invalid payload");
      }

      return {
        version: 1,
        userId: value.userId,
        returnUrl: value.returnUrl,
        expectedConnectionGeneration: value.expectedConnectionGeneration,
        nonce: value.nonce,
        expiresAt: value.expiresAt
      };
    } catch {
      throw badRequest("Invalid OAuth state");
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

  private getNow(config: GithubOAuthRuntimeConfig): Date {
    return config.now ? config.now() : new Date();
  }
}
