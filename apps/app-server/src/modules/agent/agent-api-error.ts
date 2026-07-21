import { HttpException, HttpStatus } from "@nestjs/common";

type AgentApiErrorCode =
  | "AGENT_CONVERSATION_UNAVAILABLE"
  | "AGENT_MESSAGE_ROUTING_DISABLED"
  | "AGENT_MESSAGE_ROUTING_STALE"
  | "AGENT_MESSAGE_ROUTING_UNAVAILABLE"
  | "CLIENT_REQUEST_ID_CONFLICT"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_NOT_PENDING"
  | "SERVICE_UNAVAILABLE";

function agentApiError(
  status: HttpStatus,
  code: AgentApiErrorCode,
  message: string
): HttpException {
  return new HttpException(
    {
      success: false,
      error: {
        code,
        message
      }
    },
    status
  );
}

export function confirmationExpired(message: string): HttpException {
  return agentApiError(HttpStatus.CONFLICT, "CONFIRMATION_EXPIRED", message);
}

export function agentConversationUnavailable(message: string): HttpException {
  return agentApiError(
    HttpStatus.CONFLICT,
    "AGENT_CONVERSATION_UNAVAILABLE",
    message
  );
}

export function agentMessageRoutingDisabled(message: string): HttpException {
  return agentApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    "AGENT_MESSAGE_ROUTING_DISABLED",
    message
  );
}

export function agentMessageRoutingStale(message: string): HttpException {
  return agentApiError(
    HttpStatus.CONFLICT,
    "AGENT_MESSAGE_ROUTING_STALE",
    message
  );
}

export function agentMessageRoutingUnavailable(message: string): HttpException {
  return agentApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    "AGENT_MESSAGE_ROUTING_UNAVAILABLE",
    message
  );
}

export function confirmationNotPending(message: string): HttpException {
  return agentApiError(
    HttpStatus.CONFLICT,
    "CONFIRMATION_NOT_PENDING",
    message
  );
}

export function clientRequestIdConflict(message: string): HttpException {
  return agentApiError(
    HttpStatus.CONFLICT,
    "CLIENT_REQUEST_ID_CONFLICT",
    message
  );
}

export function agentJobUnavailable(message: string): HttpException {
  return agentApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    "SERVICE_UNAVAILABLE",
    message
  );
}

export function agentStorageUnavailable(message: string): HttpException {
  return agentApiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    "SERVICE_UNAVAILABLE",
    message
  );
}
