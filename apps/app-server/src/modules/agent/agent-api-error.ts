import { HttpException, HttpStatus } from "@nestjs/common";

type AgentApiErrorCode =
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
