export function shouldFallbackToLegacyMessageApiCode(code?: string) {
  return code === "AGENT_MESSAGE_ROUTING_DISABLED";
}
