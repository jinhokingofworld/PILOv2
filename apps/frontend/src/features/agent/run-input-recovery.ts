import type { AgentRunMessage } from "@/features/agent/types";

export function getLatestAgentRunMessageSequence(
  messages: AgentRunMessage[]
) {
  return messages.reduce(
    (latestSequence, message) => Math.max(latestSequence, message.sequence),
    0
  );
}

export function didAgentRunAcceptInput(
  messages: AgentRunMessage[],
  previousLatestSequence: number,
  submittedMessage: string
) {
  return messages.some(
    (message) =>
      message.role === "user" &&
      message.sequence > previousLatestSequence &&
      message.content === submittedMessage
  );
}
