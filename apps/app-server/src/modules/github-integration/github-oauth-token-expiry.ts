export function toGithubOAuthExpiryIso(
  expiresInSeconds: unknown,
  nowEpochMs: number = Date.now()
): string | null {
  if (
    typeof expiresInSeconds !== "number" ||
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0
  ) {
    return null;
  }

  return new Date(nowEpochMs + expiresInSeconds * 1000).toISOString();
}
