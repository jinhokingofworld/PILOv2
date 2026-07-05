import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";
import type { GithubOAuthRuntimeConfig } from "./github-integration-config.service";

@Injectable()
export class GithubTokenEncryptionService {
  encryptToken(token: string, config: GithubOAuthRuntimeConfig): string {
    if (!token) {
      throw badRequest("GitHub OAuth token exchange failed");
    }

    const key = createHash("sha256")
      .update(config.tokenEncryptionKey, "utf8")
      .digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return [
      "v1",
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url")
    ].join(":");
  }
}
