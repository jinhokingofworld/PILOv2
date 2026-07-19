import { HttpException, HttpStatus } from "@nestjs/common";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "MEETING_ALREADY_IN_PROGRESS"
  | "WORKSPACE_RECORDING_CONSENT_REQUIRED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SCREEN_SHARE_ALREADY_ACTIVE"
  | "SCREEN_SHARE_NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "SQL_ERD_WRITE_PROTOCOL_MISMATCH"
  | "PAYLOAD_TOO_LARGE";

export interface ApiErrorResponse<TDetails = never> {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: TDetails;
  };
}

export class ApiError<TDetails = never> extends HttpException {
  constructor(
    status: HttpStatus,
    code: ApiErrorCode,
    message: string,
    details?: TDetails
  ) {
    super(
      {
        success: false,
        error:
          details === undefined
            ? { code, message }
            : { code, message, details }
      } satisfies ApiErrorResponse<TDetails>,
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
