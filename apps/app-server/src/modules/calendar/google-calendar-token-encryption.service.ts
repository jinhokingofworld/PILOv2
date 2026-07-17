import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest } from "../../common/api-error";

@Injectable()
export class GoogleCalendarTokenEncryptionService {
  encrypt(token: string): string {
    if (!token) throw badRequest("Google Calendar token exchange failed");
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
  }

  decrypt(value: string): string {
    try {
      const [version, encodedIv, encodedTag, encodedToken] = value.split(":");
      if (version !== "v1" || !encodedIv || !encodedTag || !encodedToken) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(encodedIv, "base64url"));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(encodedToken, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw badRequest("Google Calendar connection is invalid");
    }
  }

  private key(): Buffer {
    const secret = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim();
    if (!secret) throw badRequest("Google Calendar is not configured");
    return createHash("sha256").update(secret, "utf8").digest();
  }
}
