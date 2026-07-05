import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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

  decryptToken(encryptedToken: string, config: GithubOAuthRuntimeConfig): string {
    try {
      const [version, encodedIv, encodedTag, encodedEncrypted] =
        encryptedToken.split(":");
      if (
        version !== "v1" ||
        !encodedIv ||
        !encodedTag ||
        !encodedEncrypted
      ) {
        throw new Error("Unsupported token format");
      }

      const key = createHash("sha256")
        .update(config.tokenEncryptionKey, "utf8")
        .digest();
      const iv = Buffer.from(encodedIv, "base64url");
      const tag = Buffer.from(encodedTag, "base64url");
      const encrypted = Buffer.from(encodedEncrypted, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);

      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]).toString("utf8");
    } catch {
      throw badRequest("GitHub OAuth connection is invalid");
    }
  }
}
