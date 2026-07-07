import { HttpException, HttpStatus } from "@nestjs/common";

type AgentApiErrorCode =
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_NOT_PENDING";

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
