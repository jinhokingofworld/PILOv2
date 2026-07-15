export type SqlErdSourceLockIntervalRequest = "acquire" | "renew" | null;

export function getSourceLockIntervalRequest(
  status: "acquiring" | "disabled" | "held" | "read_only"
): SqlErdSourceLockIntervalRequest {
  if (status === "held") return "renew";
  if (status === "read_only") return "acquire";
  return null;
}
