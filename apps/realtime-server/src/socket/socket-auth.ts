import type { IncomingHttpHeaders } from "node:http";

export type RealtimeSocketAuthContext = {
  displayName?: string;
  token: string;
  userId?: string;
};

type SocketHandshakeAuth = {
  displayName?: unknown;
  token?: unknown;
  userId?: unknown;
};

export function extractBearerToken(headers: IncomingHttpHeaders) {
  const authorization = headers.authorization;

  if (!authorization) return null;
  if (Array.isArray(authorization)) return null;

  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;

  return token;
}

export function createSocketAuthContext(
  headers: IncomingHttpHeaders,
  auth: SocketHandshakeAuth = {},
): RealtimeSocketAuthContext | null {
  const token =
    typeof auth.token === "string" ? auth.token : extractBearerToken(headers);

  if (!token) return null;

  return {
    ...(typeof auth.displayName === "string"
      ? { displayName: auth.displayName }
      : {}),
    token,
    ...(typeof auth.userId === "string" ? { userId: auth.userId } : {}),
  };
}
