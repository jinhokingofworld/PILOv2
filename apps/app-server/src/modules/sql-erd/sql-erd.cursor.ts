import { badRequest } from "../../common/api-error";
import { SqlErdSessionCursor } from "./sql-erd.types";

const CURSOR_VERSION = 1;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MICROSECOND_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

interface SqlErdSessionCursorEnvelope extends SqlErdSessionCursor {
  v: typeof CURSOR_VERSION;
}

export function encodeSqlErdSessionCursor(
  cursor: SqlErdSessionCursor
): string {
  assertCursorFields(cursor.updatedAt, cursor.id);

  return Buffer.from(
    JSON.stringify({
      v: CURSOR_VERSION,
      updatedAt: cursor.updatedAt,
      id: cursor.id
    } satisfies SqlErdSessionCursorEnvelope),
    "utf8"
  ).toString("base64url");
}

export function decodeSqlErdSessionCursor(value: string): SqlErdSessionCursor {
  if (!value || !CURSOR_PATTERN.test(value)) {
    throw invalidCursor();
  }

  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw new Error("cursor is not canonical base64url");
    }
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalidCursor();
  }

  if (!isCursorEnvelope(parsed)) {
    throw invalidCursor();
  }

  assertCursorFields(parsed.updatedAt, parsed.id);
  return {
    updatedAt: parsed.updatedAt,
    id: parsed.id
  };
}

function isCursorEnvelope(
  value: unknown
): value is SqlErdSessionCursorEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    keys.includes("v") &&
    keys.includes("updatedAt") &&
    keys.includes("id") &&
    "v" in value &&
    value.v === CURSOR_VERSION &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function assertCursorFields(updatedAt: string, id: string): void {
  if (!isValidMicrosecondTimestamp(updatedAt) || !UUID_PATTERN.test(id)) {
    throw invalidCursor();
  }
}

function isValidMicrosecondTimestamp(value: string): boolean {
  if (!MICROSECOND_ISO_PATTERN.test(value)) {
    return false;
  }

  const millisecondValue = `${value.slice(0, 23)}Z`;
  const date = new Date(millisecondValue);
  return !Number.isNaN(date.getTime()) && date.toISOString() === millisecondValue;
}

function invalidCursor(): ReturnType<typeof badRequest> {
  return badRequest("sqltoerd cursor is invalid");
}
