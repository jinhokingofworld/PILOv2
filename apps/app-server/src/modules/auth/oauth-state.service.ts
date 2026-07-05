import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import type { AuthProviderRuntimeConfig } from "./auth-config.service";
import type { LoginProvider } from "./types";

export interface LoginStateInput {
  provider: LoginProvider;
  returnUrl: string | null;
}

export interface LoginStatePayload extends LoginStateInput {
  nonce: string;
  expiresAt: number;
}

interface SerializedLoginState extends LoginStatePayload {
  version: 1;
}

@Injectable()
export class OAuthStateService {
  createState(input: LoginStateInput, config: AuthProviderRuntimeConfig): string {
    const now = this.getNow(config).getTime();
    const payload: SerializedLoginState = {
      version: 1,
      provider: input.provider,
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
    provider: LoginProvider,
    config: AuthProviderRuntimeConfig
  ): LoginStatePayload {
    const [encodedPayload, signature, ...rest] = state.split(".");
    if (!encodedPayload || !signature || rest.length > 0) {
      throw badRequest("Invalid OAuth state");
    }

    const expectedSignature = this.sign(encodedPayload, config.stateSecret);
    if (!this.constantTimeEqual(signature, expectedSignature)) {
      throw badRequest("Invalid OAuth state");
    }

    const payload = this.parsePayload(encodedPayload);
    if (payload.provider !== provider) {
      throw badRequest("Invalid OAuth state");
    }

    if (payload.expiresAt <= this.getNow(config).getTime()) {
      throw badRequest("Invalid OAuth state");
    }

    return {
      provider: payload.provider,
      returnUrl: payload.returnUrl,
      nonce: payload.nonce,
      expiresAt: payload.expiresAt
    };
  }

  private parsePayload(encodedPayload: string): SerializedLoginState {
    try {
      const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
      const value = JSON.parse(decoded) as Partial<SerializedLoginState>;

      if (
        value.version !== 1 ||
        (value.provider !== "google" && value.provider !== "github") ||
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
        provider: value.provider,
        returnUrl: value.returnUrl,
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

  private getNow(config: AuthProviderRuntimeConfig): Date {
    return config.now ? config.now() : new Date();
  }
}
