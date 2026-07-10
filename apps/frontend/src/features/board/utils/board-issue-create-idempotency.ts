export function resolveBoardIssueCreateIdempotencyKey(
  currentKey: string | null
) {
  return currentKey ?? crypto.randomUUID();
}
