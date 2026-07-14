import { HttpException, HttpStatus } from "@nestjs/common";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "MEETING_ALREADY_IN_PROGRESS"
  | "WORKSPACE_RECORDING_CONSENT_REQUIRED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SQL_ERD_WRITE_PROTOCOL_MISMATCH"
  | "PAYLOAD_TOO_LARGE";

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: ApiErrorCode, message: string) {
    super(
      {
        success: false,
        error: {
          code,
          message
        }
      } satisfies ApiErrorResponse,
      status
    );
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(HttpStatus.BAD_REQUEST, "BAD_REQUEST", message);
}

export function unauthorized(message: string): ApiError {
  return new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
}

export function notFound(message: string): ApiError {
  return new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
}

export function conflict(message: string): ApiError {
  return new ApiError(HttpStatus.CONFLICT, "CONFLICT", message);
}

export function sqlErdWriteProtocolMismatch(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    "SQL_ERD_WRITE_PROTOCOL_MISMATCH",
    "SQLtoERD session write protocol does not allow this request"
  );
}

export function workspaceRecordingConsentRequired(): ApiError {
  return new ApiError(
    HttpStatus.CONFLICT,
    "WORKSPACE_RECORDING_CONSENT_REQUIRED",
    "Workspace recording consent is required"
  );
}

export function payloadTooLarge(message: string): ApiError {
  return new ApiError(
    HttpStatus.PAYLOAD_TOO_LARGE,
    "PAYLOAD_TOO_LARGE",
    message
  );
}
