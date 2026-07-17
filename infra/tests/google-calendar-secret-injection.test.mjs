import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [secretsModule, secretScript] = await Promise.all([
  readFile(new URL("../modules/secrets/main.tf", import.meta.url), "utf8"),
  readFile(new URL("../scripts/set-dev-external-secrets.ps1", import.meta.url), "utf8")
]);

assert.match(secretsModule, /"GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"/);
assert.match(
  secretScript,
  /\$googleCalendarTokenEncryptionKey\s*=\s*Read-OptionalSecureText\s+"GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"/
);
assert.match(
  secretScript,
  /Put-SecretIfPresent\s+"pilo-dev\/app-server\/GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"\s+\$googleCalendarTokenEncryptionKey/
);

console.log("Google Calendar secret injection infrastructure is verified.");
